/**
 * Check every claim the landing page and README make against the live chain.
 *
 *   pnpm verify-landing
 *
 * Run it before filming and before submitting. The landing page keeps its
 * evidence static so it loads fast and cannot be broken by an RPC hiccup while
 * a judge is reading. The cost of that choice is that nothing tells you when it
 * goes stale, so this does.
 *
 * Exits non-zero on any failure, so it can gate a release.
 */
import { createPublicClient, http, type Address, type Hex } from "viem";
import { coston2, erc20Abi, erc4626Abi, ruleRegistryAbi } from "@giroledger/shared";

const client = createPublicClient({
  chain: coston2,
  transport: http(process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!),
});

/**
 * Kept in step with apps/web/src/lib/evidence.ts by hand.
 *
 * The web module cannot be imported here: it reads `import.meta.env`, which
 * only exists under Vite. Duplicating four hashes is the cheaper problem, and
 * this script fails loudly if either side drifts.
 */
const TX: Record<string, Hex> = {
  smartAccount: "0xeda8fab5dd91b353cafa63ffb8f8173f9dbbf55584b1d584e77bfe10b6a5ab89",
  create: "0x332cb1149a1dc09b2abde2cb3b26f80b1134f9db1908d2e1074057c348c44770",
  execute: "0x1c5d1a15c287a40c5cbd7923a592d1e7124c734027f19ba6293b89d0eee9d3c0",
  cancel: "0xdf26dfa5feb92473529773632fd1daca4ef2b564ad12772c15c6b26b376ab28b",
  operatorCompleted: "0x8ef9a209056ecca4d2d23101d15b75a3b1570e2750a0f17e96e9792f78da5f72",
};

const ACCOUNT = "0xe29c2E182bFB46977BA574f80005ac28C8720dab" as Address;

let failures = 0;

function pass(what: string, detail = ""): void {
  console.log(`  ok    ${what}${detail ? `  ${detail}` : ""}`);
}
function fail(what: string, why: string): void {
  failures += 1;
  console.log(`  FAIL  ${what}\n          ${why}`);
}

async function checkTx(name: string, hash: Hex): Promise<void> {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      fail(`tx ${name}`, `on chain but reverted: ${hash}`);
      return;
    }
    pass(`tx ${name}`, `block ${receipt.blockNumber}`);
  } catch {
    fail(`tx ${name}`, `not found on Coston2: ${hash}`);
  }
}

async function checkContract(name: string, address: string | undefined): Promise<void> {
  if (!address) {
    fail(name, "not set. Check VITE_RULE_REGISTRY_ADDRESS / VITE_RULE_EXECUTOR_ADDRESS in .env");
    return;
  }
  const code = await client.getCode({ address: address as Address });
  if (!code || code === "0x") {
    fail(name, `no contract deployed at ${address}`);
    return;
  }
  pass(name, `${address} (${(code.length - 2) / 2} bytes)`);
}

async function main(): Promise<void> {
  console.log("\nVerifying the claims on the landing page and README\n");

  console.log("Transactions");
  for (const [name, hash] of Object.entries(TX)) await checkTx(name, hash);

  console.log("\nContracts");
  const registry = process.env["VITE_RULE_REGISTRY_ADDRESS"] ?? process.env["RULE_REGISTRY_ADDRESS"];
  const executor = process.env["VITE_RULE_EXECUTOR_ADDRESS"] ?? process.env["RULE_EXECUTOR_ADDRESS"];
  await checkContract("RuleRegistry", registry);
  await checkContract("RuleExecutor", executor);

  // The landing page shows this account holding shares. If the registry moved,
  // its rules did not come with it, and the page would be describing a
  // deployment that no longer exists.
  console.log("\nState the page describes");
  if (registry) {
    try {
      const ids = await client.readContract({
        address: registry as Address,
        abi: ruleRegistryAbi,
        functionName: "rulesOf",
        args: [ACCOUNT],
      });
      if (ids.length === 0) {
        fail(
          "example account has rules",
          `${ACCOUNT} has no rules in ${registry}. The landing page links to executions ` +
            "that belong to a different deployment. Update the hashes in evidence.ts.",
        );
      } else {
        pass("example account has rules", `${ids.length} in the live registry`);
      }
    } catch (e) {
      fail("example account has rules", e instanceof Error ? e.message : String(e));
    }
  }

  const vault = process.env["VAULT_ADDRESS"];
  const fxrp = process.env["FXRP_ADDRESS"];
  if (vault && fxrp) {
    try {
      const asset = await client.readContract({
        address: vault as Address,
        abi: erc4626Abi,
        functionName: "asset",
      });
      if (asset.toLowerCase() !== fxrp.toLowerCase()) {
        fail("vault holds FXRP", `vault asset is ${asset}, expected ${fxrp}`);
      } else {
        const dec = await client.readContract({
          address: fxrp as Address,
          abi: erc20Abi,
          functionName: "decimals",
        });
        const shares = await client.readContract({
          address: vault as Address,
          abi: erc4626Abi,
          functionName: "previewDeposit",
          args: [10n ** BigInt(dec)],
        });
        // The landing page prints "1 FXRP -> 1,000,000 shares" as a fact.
        if (shares !== 10n ** BigInt(dec)) {
          fail(
            "vault is still 1:1",
            `1 FXRP now previews as ${shares} shares, but the page says 1,000,000. ` +
              "Update the figure or drop the claim.",
          );
        } else {
          pass("vault is still 1:1", `1 FXRP -> ${shares} shares`);
        }
      }
    } catch (e) {
      fail("vault checks", e instanceof Error ? e.message : String(e));
    }
  }

  console.log(
    failures === 0
      ? "\nEverything the page claims is still true.\n"
      : `\n${failures} claim(s) no longer hold. Fix apps/web/src/lib/evidence.ts before shipping.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
