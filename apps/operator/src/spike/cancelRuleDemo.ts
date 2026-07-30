/**
 * Stop a live rule from the XRP side.
 *
 *   RULE_ID=0x… pnpm --filter @giroledger/operator cancel-rule
 *
 * Proves the claim the README makes about cancellation. Costs 0.2 XRP and takes
 * roughly two to three minutes, almost all of it waiting for the FDC round.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client, Wallet } from "xrpl";
import { coston2 } from "@giroledger/shared";
import { cancelRule } from "../cancelRule.js";
import type { CreateRuleContext } from "../createRule.js";

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Check .env`);
  return v;
};

async function main(): Promise<void> {
  const rpc = process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!;
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const account = privateKeyToAccount(required("OPERATOR_PRIVATE_KEY") as Hex);
  const walletClient = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const xrplClient = new Client(required("XRPL_WSS_URL"), { connectionTimeout: 30_000 });
  await xrplClient.connect();
  const xrplWallet = Wallet.fromSeed(required("XRPL_SEED"));

  const ruleId = required("RULE_ID") as Hex;

  const ctx: CreateRuleContext = {
    publicClient,
    walletClient,
    xrplClient,
    xrplWallet,
    contracts: {
      fxrp: required("FXRP_ADDRESS") as Address,
      ruleRegistry: required("RULE_REGISTRY_ADDRESS") as Address,
      ruleExecutor: required("RULE_EXECUTOR_ADDRESS") as Address,
    },
    verifier: {
      baseUrl: required("FDC_VERIFIER_URL"),
      apiKey: process.env["FDC_VERIFIER_API_KEY"] ?? "",
    },
    log: (m) => console.log(`  ${m}`),
  };

  console.log("\nGiroLedger: stopping a standing order from one XRPL payment\n");
  console.log(`  rule ${ruleId}\n`);

  try {
    const r = await cancelRule(ruleId, ctx);
    console.log("\n  ---");
    console.log(`  RULE CANCELLED ${r.ruleId}`);
    console.log(`  active         ${r.active}   (must be false)`);
    console.log(
      `  allowance      ${r.allowance}   (must be ${r.expectedAllowance}, what other active rules still need)`,
    );
    console.log(`  cost           ${r.amountXrp} XRP`);
    console.log(`  took           ${(r.elapsedMs / 1000).toFixed(0)}s`);
    console.log(`  XRPL payment   ${r.xrplTransactionHash}`);
    console.log(`  Flare tx       ${r.flareTransactionHash}`);

    if (r.active || r.allowance !== r.expectedAllowance) {
      console.log("\n  FAILED: the rule is not fully stopped. Do not claim this works.\n");
      process.exit(1);
    }
    console.log("\n  The executor can no longer move any FXRP for this rule.");
    if (r.expectedAllowance > 0n) {
      console.log("  Other active rules on this account are untouched and still work.");
    }
    console.log();
  } finally {
    await xrplClient.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("\nfailed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
