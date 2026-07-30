/**
 * Send the payment the way a user with a wallet would, and stop there.
 *
 *   pnpm --filter @giroledger/operator pay
 *
 * Stands in for the browser: it registers the instruction with the operator,
 * sends the XRPL payment, and does nothing else. No attestation, no submission.
 * The operator is expected to finish the job.
 *
 * Originally written to answer a different question: does anything pick up a
 * payment nobody follows up on? Answered on 28 July, and the answer is no.
 * Flare's public operator wallets do not complete direct-minting payments, so
 * `create-rule` had been quietly doing the operator's work all along.
 *
 * Uses the same `buildCreateRuleInstruction` and the same shortfall pricing as
 * the web page, so what it sends is what the page displays.
 */
import { createPublicClient, http, type Address } from "viem";
import { Client, Wallet } from "xrpl";
import {
  buildCreateRuleInstruction,
  coston2,
  erc20Abi,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  sumActiveCommitment,
  Trigger,
  type CreateRuleParams,
} from "@giroledger/shared";
import { computePaymentXrp, contractByName } from "../createRule.js";

const req = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} not set`);
  return v;
};

/** XRPL testnet base reserve. Spending below it bounces with tecUNFUNDED_PAYMENT. */
const RESERVE_XRP = 1;

async function main(): Promise<void> {
  const rpc = process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!;
  const client = createPublicClient({ chain: coston2, transport: http(rpc) });

  const registry = req("RULE_REGISTRY_ADDRESS") as Address;
  const executor = req("RULE_EXECUTOR_ADDRESS") as Address;
  const fxrp = req("FXRP_ADDRESS") as Address;
  const vault = req("VAULT_ADDRESS") as Address;

  const amountPerRun = BigInt(process.env["RULE_AMOUNT_UBA"] ?? "1000000"); // 1 FXRP
  const maxRuns = Number(process.env["RULE_MAX_RUNS"] ?? 3);
  const intervalSecs = Number(process.env["RULE_INTERVAL_SECS"] ?? 120);

  const xrplClient = new Client(req("XRPL_WSS_URL"), { connectionTimeout: 30_000 });
  await xrplClient.connect();
  const wallet = Wallet.fromSeed(req("XRPL_SEED"));

  try {
    const mac = await contractByName(client, "MasterAccountController");
    const assetManager = await contractByName(client, "AssetManagerFXRP");

    const account = (await client.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getPersonalAccount",
      args: [wallet.address],
    })) as Address;

    // Read the nonce as late as possible. Two payments built from one nonce
    // collide and the loser's XRP is stranded at the Core Vault.
    const nonce = (await client.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getNonce",
      args: [account],
    })) as bigint;

    const params: CreateRuleParams = {
      vault,
      amountPerRun,
      totalSpendCap: amountPerRun * BigInt(maxRuns),
      intervalSecs,
      maxRuns,
      trigger: Trigger.TIME,
      startAt: 0n,
      thresholdPrice: 0n,
    };

    // Same allowance arithmetic the page does: cover this rule AND whatever the
    // account's existing active rules still need.
    const ids = await client.readContract({
      address: registry,
      abi: ruleRegistryAbi,
      functionName: "rulesOf",
      args: [account],
    });
    const existing = await Promise.all(
      ids.map(async (ruleId) => {
        const r = await client.readContract({
          address: registry,
          abi: ruleRegistryAbi,
          functionName: "getRule",
          args: [ruleId],
        });
        return {
          ruleId,
          active: r.active,
          totalSpendCap: r.totalSpendCap,
          totalSpent: r.totalSpent,
        };
      }),
    );
    const otherActiveCommitment = sumActiveCommitment(existing);

    const instruction = buildCreateRuleInstruction({
      params,
      contracts: { fxrp, ruleRegistry: registry, ruleExecutor: executor },
      personalAccount: account,
      nonce,
      otherActiveCommitment,
    });

    // Same shortfall pricing the page does. The rule has to be able to fund
    // itself, or every execution fails at transferFrom.
    const held = (await client.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    })) as bigint;
    const shortfallUBA =
      params.totalSpendCap > held ? params.totalSpendCap - held : 0n;
    const amountXrp = await computePaymentXrp(client, Number(shortfallUBA) / 1e6);

    const destination = (await client.readContract({
      address: assetManager,
      abi: [
        {
          type: "function",
          name: "directMintingPaymentAddress",
          stateMutability: "view",
          inputs: [],
          outputs: [{ name: "", type: "string" }],
        },
      ] as const,
      functionName: "directMintingPaymentAddress",
    })) as string;

    /*
     * Hand the instruction over BEFORE paying, exactly as the browser does.
     *
     * The memo carries only a hash, so an operator that was never given the
     * operation cannot complete the payment. An earlier version of this script
     * skipped this step, which made the operator log "payment seen before its
     * instruction" and do nothing. The operator now holds such payments and
     * finishes them on registration, but paying first is still the wrong order.
     */
    const operatorUrl = process.env["OPERATOR_URL"] ?? "http://localhost:8080";
    let registered = false;
    try {
      const res = await fetch(`${operatorUrl.replace(/\/$/, "")}/instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: instruction.data,
          memoData: instruction.memoData,
          userOpHash: instruction.userOpHash,
          totalCallValue: instruction.totalCallValue.toString(),
        }),
      });
      registered = res.ok;
      if (!res.ok) console.log(`  operator rejected the instruction: ${await res.text()}`);
    } catch {
      console.log(`  operator unreachable at ${operatorUrl}`);
    }

    if (!registered) {
      console.log("\n  WARNING: nothing is listening for this payment.");
      console.log("  Start the operator first:  pnpm dev:operator");
      console.log("  Paying anyway leaves the XRP at the Core Vault until it is completed.\n");
    } else {
      console.log("  instruction handed to the operator\n");
    }

    const info = await xrplClient.request({
      command: "account_info",
      account: wallet.address,
      ledger_index: "validated",
    });
    const balanceXrp = Number(info.result.account_data.Balance) / 1_000_000;

    console.log("\nGiroLedger: sending the payment and stopping there\n");
    console.log(`  account       ${account}`);
    console.log(`  holds         ${Number(held) / 1e6} FXRP`);
    console.log(`  rule          ${Number(amountPerRun) / 1e6} FXRP x ${maxRuns} every ${intervalSecs}s`);
    console.log(`  cap           ${Number(params.totalSpendCap) / 1e6} FXRP`);
    console.log(`  shortfall     ${Number(shortfallUBA) / 1e6} FXRP to mint`);
    console.log(`  nonce         ${nonce}`);
    console.log(`  memo          ${instruction.memoData}`);
    console.log(`\n  paying ${amountXrp} XRP to ${destination} (balance ${balanceXrp})\n`);

    if (balanceXrp < amountXrp + RESERVE_XRP) {
      throw new Error(
        `Balance ${balanceXrp} XRP is short. Needs ${amountXrp + RESERVE_XRP} ` +
          `(${amountXrp} payment + ${RESERVE_XRP} base reserve). ` +
          "Top up at https://xrpl.org/xrp-testnet-faucet.html",
      );
    }

    const prepared = await xrplClient.autofill({
      TransactionType: "Payment",
      Account: wallet.address,
      Destination: destination,
      Amount: String(Math.round(amountXrp * 1_000_000)),
      // NO DestinationTag. A tag makes FAssets credit the tag holder instead.
      Memos: [{ Memo: { MemoData: instruction.memoData.slice(2).toUpperCase() } }],
    });
    const submitted = await xrplClient.submitAndWait(wallet.sign(prepared).tx_blob);
    const hash = submitted.result.hash;

    const meta = submitted.result.meta;
    const result =
      typeof meta === "object" && meta !== null && "TransactionResult" in meta
        ? (meta as { TransactionResult: string }).TransactionResult
        : "unknown";

    console.log(`  XRPL tx       ${hash} (${result})`);
    if (result !== "tesSUCCESS") {
      console.log("\n  The payment did not deliver. Nothing minted, nothing stranded.\n");
      process.exit(1);
    }

    console.log("\n  Sent. The operator should complete it within two to three minutes.\n");
    console.log("  Watch the operator log, or check when it is done:\n");
    console.log(`    PERSONAL_ACCOUNT=${account} pnpm --filter @giroledger/operator rules\n`);
  } finally {
    await xrplClient.disconnect();
  }
}

main().catch((e: unknown) => {
  console.error("\nfailed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
