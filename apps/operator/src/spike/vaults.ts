/**
 * List Flare's vaults with full addresses, and optionally allowlist one.
 *
 *   pnpm --filter @giroledger/operator vaults
 *   ALLOW_VAULT=0x... pnpm --filter @giroledger/operator vaults
 *
 * Written because two vault lists disagree and the difference is expensive.
 * `MasterAccountController.getVaults()` is Flare's list; `RuleRegistry` only
 * accepts what its owner allowlisted. A rule pointed at a vault missing from
 * the second reverts only AFTER the XRPL payment has been made and the FDC
 * round has finalised, several minutes later.
 *
 * Every vault is checked as a real ERC-4626 over FXRP before being allowlisted.
 * Allowlisting something that is not a vault, or is a vault over a different
 * asset, produces a rule that fails at deposit time with the money already
 * moved out of the user's account.
 */
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  coston2,
  erc20Abi,
  erc4626Abi,
  explorerTx,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  vaultTypeLabel,
} from "@giroledger/shared";

const req = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} not set`);
  return v;
};

async function main(): Promise<void> {
  const client = createPublicClient({
    chain: coston2,
    transport: http(process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!),
  });

  const registry = req("RULE_REGISTRY_ADDRESS") as Address;
  const fxrp = req("FXRP_ADDRESS") as Address;
  const mac = req("MASTER_ACCOUNT_CONTROLLER") as Address;

  const [ids, addresses, types] = await client.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getVaults",
  });

  const dec = await client.readContract({ address: fxrp, abi: erc20Abi, functionName: "decimals" });

  console.log(`\nFlare vaults (MasterAccountController ${mac})`);
  console.log(`Our registry ${registry}\n`);

  const configured = process.env["VAULT_ADDRESS"]?.toLowerCase();
  const rows = addresses.map((address, i) => ({
    id: ids[i] ?? 0n,
    address: address as Address,
    type: types[i] ?? 0,
  }));

  for (const row of rows) {
    const [allowed, asset] = await Promise.all([
      client.readContract({
        address: registry,
        abi: ruleRegistryAbi,
        functionName: "vaultAllowed",
        args: [row.address],
      }),
      client
        .readContract({ address: row.address, abi: erc4626Abi, functionName: "asset" })
        .catch(() => null),
    ]);

    const assetOk = asset !== null && asset.toLowerCase() === fxrp.toLowerCase();
    const marks = [
      allowed ? "ALLOWLISTED" : "not allowlisted",
      assetOk ? "FXRP" : asset === null ? "NOT AN ERC-4626" : `asset ${asset}`,
    ];
    console.log(
      `  ${vaultTypeLabel[row.type] ?? `type ${row.type}`} #${row.id}  ${row.address}`,
    );
    console.log(`      ${marks.join("  ·  ")}`);
  }

  if (configured && !rows.some((r) => r.address.toLowerCase() === configured)) {
    const allowed = await client.readContract({
      address: registry,
      abi: ruleRegistryAbi,
      functionName: "vaultAllowed",
      args: [configured as Address],
    });
    console.log(`\n  VAULT_ADDRESS ${configured}`);
    console.log(
      `      ${allowed ? "ALLOWLISTED" : "not allowlisted"}  ·  NOT in Flare's list`,
    );
    console.log("      It works, but it is not one Flare currently advertises.");
  }

  const target = process.env["ALLOW_VAULT"];
  if (!target) {
    console.log("\n  To allowlist one:  ALLOW_VAULT=0x… pnpm --filter @giroledger/operator vaults\n");
    return;
  }

  const vault = target as Address;

  // Refuse to allowlist something that is not an FXRP vault. Getting this wrong
  // means the rule reverts at deposit, after the user's FXRP has already moved.
  const asset = await client
    .readContract({ address: vault, abi: erc4626Abi, functionName: "asset" })
    .catch(() => null);
  if (asset === null) throw new Error(`${vault} does not answer asset(): not an ERC-4626`);
  if (asset.toLowerCase() !== fxrp.toLowerCase()) {
    throw new Error(`${vault} holds ${asset}, not FXRP ${fxrp}`);
  }

  const preview = await client.readContract({
    address: vault,
    abi: erc4626Abi,
    functionName: "previewDeposit",
    args: [10n ** BigInt(dec)],
  });
  if (preview === 0n) throw new Error(`${vault} would mint 0 shares for 1 FXRP`);
  console.log(`\n  ${vault} checks out: 1 FXRP previews as ${preview} shares`);

  const account = privateKeyToAccount(req("PRIVATE_KEY") as `0x${string}`);
  const owner = await client.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "owner",
  });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`registry owner is ${owner}, but PRIVATE_KEY is ${account.address}`);
  }

  const wallet = createWalletClient({
    account,
    chain: coston2,
    transport: http(process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!),
  });

  const { request } = await client.simulateContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "setVaultAllowed",
    args: [vault, true],
    account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`  allowlisted in ${receipt.status}  ${explorerTx(hash)}`);
  console.log(`\n  Now set VAULT_ADDRESS and VITE_VAULT_ADDRESS to ${vault} in .env\n`);
}

main().catch((e: unknown) => {
  console.error("failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
