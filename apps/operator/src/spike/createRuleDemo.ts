/**
 * Create one real GiroLedger rule from one real XRPL payment.
 *
 *   pnpm --filter @giroledger/operator create-rule
 *
 * This is the whole product in a single command. It should print `RuleCreated`
 * with a rule id and a Coston2 transaction hash after roughly two and a half
 * minutes, almost all of which is the FDC attestation round.
 *
 * Required in .env:
 *   PRIVATE_KEY               executor / gas payer
 *   XRPL_SEED                 signs the payment
 *   XRPL_TESTNET_RPC_URL
 *   RULE_REGISTRY_ADDRESS     from pnpm contracts:deploy
 *   RULE_EXECUTOR_ADDRESS     from pnpm contracts:deploy
 *   FXRP_ADDRESS              0x0b6A3645c240605887a5532109323A3E12273dc7
 *   VAULT_ADDRESS             0xF97B2bBdB2f4a561806e5038a503eCA81554634E
 *   FDC_VERIFIER_URL, FDC_VERIFIER_API_KEY
 *   FDC_DA_LAYER_URL, FDC_DA_LAYER_API_KEY
 *
 * BEFORE RUNNING, two things that are not checked here and will cost you an
 * XRPL payment if wrong:
 *   - the PERSONAL ACCOUNT needs C2FLR if any call carries value. Ours carry
 *     zero, so this only matters if you change the calls.
 *   - never run this twice concurrently for one XRPL wallet. Both payments
 *     would embed the same nonce, the second reverts with InvalidNonce, and its
 *     XRP is stranded at the Core Vault.
 */
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client, Wallet } from "xrpl";
import { coston2, Trigger, type CreateRuleParams } from "@giroledger/shared";

import { createRule, type CreateRuleContext } from "../createRule.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See the header of this file.`);
  return v;
}

async function main(): Promise<void> {
  const rpc = process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!;

  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const account = privateKeyToAccount(required("PRIVATE_KEY") as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const xrplClient = new Client(required("XRPL_TESTNET_RPC_URL"), {
    connectionTimeout: 30_000,
  });
  await xrplClient.connect();
  const xrplWallet = Wallet.fromSeed(required("XRPL_SEED"));

  // One FXRP per run, five runs. Small enough that the direct mint is never
  // rate limited: spike:limits showed ~92,000 XRP of hourly headroom.
  //
  // The interval is overridable because an hour is unfilmable. The demo needs
  // three visible executions inside a ninety second shot, so record with
  // RULE_INTERVAL_SECS=60. Floor is MIN_INTERVAL_SECS on RuleRegistry.
  const intervalSecs = Number(process.env["RULE_INTERVAL_SECS"] ?? 3600);
  if (!Number.isInteger(intervalSecs) || intervalSecs < 60) {
    throw new Error(`RULE_INTERVAL_SECS must be a whole number >= 60, got ${intervalSecs}`);
  }
  const maxRuns = Number(process.env["RULE_MAX_RUNS"] ?? 5);
  if (!Number.isInteger(maxRuns) || maxRuns < 1) {
    throw new Error(`RULE_MAX_RUNS must be a whole number >= 1, got ${maxRuns}`);
  }

  const params: CreateRuleParams = {
    vault: required("VAULT_ADDRESS") as Address,
    amountPerRun: 1_000_000n, // 1 FXRP, 6 decimals
    // The ceiling is exactly what the rule can ever need. Approving more would
    // weaken invariant I1, which is the claim the README leads with.
    totalSpendCap: 1_000_000n * BigInt(maxRuns),
    intervalSecs,
    maxRuns,
    trigger: Trigger.TIME,
    startAt: 0n,
    thresholdPrice: 0n,
  };
  console.log(`  interval     ${intervalSecs}s, ${maxRuns} runs`);

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

  console.log("\nGiroLedger: creating a standing order from one XRPL payment\n");
  const every =
    intervalSecs % 3600 === 0
      ? `${intervalSecs / 3600}h`
      : intervalSecs % 60 === 0
        ? `${intervalSecs / 60}min`
        : `${intervalSecs}s`;
  console.log(`  1 FXRP every ${every}, ${maxRuns} times, into vault ${params.vault}`);
  console.log(`  hard ceiling ${Number(params.totalSpendCap) / 1e6} FXRP\n`);

  try {
    const result = await createRule(params, ctx);
    console.log("\n  ---");
    console.log(`  RULE CREATED   ${result.ruleId}`);
    console.log(`  account        ${result.personalAccount}`);
    console.log(`  XRPL payment   ${result.xrplTransactionHash}`);
    console.log(`  Flare tx       ${result.flareTransactionHash}`);
    console.log(`  took           ${(result.elapsedMs / 1000).toFixed(0)}s`);
    console.log("\n  Now start the keeper and watch it execute on its own:");
    console.log("    pnpm dev:keeper\n");
  } finally {
    await xrplClient.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("\nfailed:", error);
  process.exit(1);
});
