/**
 * Finish a rule whose XRPL payment already landed.
 *
 *   XRPL_TX=0D562EDE... RULE_NONCE=1 pnpm --filter @giroledger/operator finish-rule
 *
 * WHY THIS EXISTS
 *
 * The `0xFE` flow is two independent halves. The user half sends one XRPL
 * payment carrying a 42-byte commitment. The executor half fetches an FDC proof
 * and submits it. If the executor half fails for any reason, the XRP sits at
 * the Core Vault with a perfectly valid memo, and re-running the whole flow
 * would send a SECOND payment and strand the first.
 *
 * So: never re-run `create-rule` after a failed executor step. Run this.
 *
 * The user operation is fully deterministic from (params, contracts,
 * personalAccount, nonce), so we can rebuild the exact bytes the memo committed
 * to. If the rebuild does not hash to the same value the memo carried, the
 * chain rejects it with `CustomInstructionHashMismatch`, which is the check
 * doing its job.
 */
import { createPublicClient, createWalletClient, http, parseEventLogs, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Client, Wallet } from "xrpl";
import {
  assetManagerFxrpAbi,
  buildCreateRuleInstruction,
  coston2,
  explorerTx,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  Trigger,
  type CreateRuleParams,
} from "@giroledger/shared";

import {
  contractByName,
  fetchXrpPaymentProof,
  normalizeTxId,
  readActiveCommitment,
  type CreateRuleContext,
} from "../createRule.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * MUST match what create-rule used, exactly. Any difference changes the hash
 * and the chain will refuse the proof.
 */
const AMOUNT_PER_RUN = BigInt(process.env["RULE_AMOUNT_UBA"] ?? "1000000");
const MAX_RUNS = Number(process.env["RULE_MAX_RUNS"] ?? 3);

const params: CreateRuleParams = {
  vault: (process.env["VAULT_ADDRESS"] ?? "") as Address,
  amountPerRun: AMOUNT_PER_RUN,
  totalSpendCap: AMOUNT_PER_RUN * BigInt(MAX_RUNS),
  intervalSecs: Number(process.env["RULE_INTERVAL_SECS"] ?? 120),
  maxRuns: MAX_RUNS,
  trigger: Trigger.TIME,
  startAt: 0n,
  thresholdPrice: 0n,
};

async function main(): Promise<void> {
  const xrplTx = required("XRPL_TX");
  const nonce = BigInt(required("RULE_NONCE"));
  const rpc = process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!;

  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const account = privateKeyToAccount(required("PRIVATE_KEY") as Hex);
  const walletClient = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const xrplClient = new Client(required("XRPL_TESTNET_RPC_URL"), { connectionTimeout: 30_000 });
  await xrplClient.connect();
  const xrplWallet = Wallet.fromSeed(required("XRPL_SEED"));

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
  };

  const say = (m: string) => console.log(`  ${m}`);
  console.log("\nFinishing a rule whose XRPL payment already landed\n");

  try {
    const mac = await contractByName(publicClient, "MasterAccountController");
    const assetManager = await contractByName(publicClient, "AssetManagerFXRP");

    const personalAccount = (await publicClient.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getPersonalAccount",
      args: [xrplWallet.address],
    })) as Address;

    const currentNonce = (await publicClient.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getNonce",
      args: [personalAccount],
    })) as bigint;

    if (currentNonce !== nonce) {
      throw new Error(
        `On-chain nonce is ${currentNonce} but you passed ${nonce}. ` +
          "If the on-chain nonce already advanced, that payment was consumed and " +
          "this rule may already exist. Check the registry before resending anything.",
      );
    }

    // The allowance term is part of the hash. Recomputed from chain state, the
    // same way the payment computed it. If any rule executed in between this
    // will differ and the memo will not match, which the check below catches
    // before an FDC round is spent.
    const otherActiveCommitment = await readActiveCommitment(ctx, personalAccount);

    const instruction = buildCreateRuleInstruction({
      params,
      contracts: ctx.contracts,
      personalAccount,
      nonce,
      otherActiveCommitment,
    });

    say(`personal account ${personalAccount}`);
    say(`nonce            ${nonce}`);
    say(`commitment       ${otherActiveCommitment} drops held for other active rules`);
    say(`memo             ${instruction.memoData}`);

    // Refuse to spend an attestation round on a memo that cannot match. The
    // payment committed to one exact hash; rebuilding a different one means the
    // parameters here are wrong, and the chain would reject the proof anyway.
    const expected = process.env["EXPECT_MEMO"];
    if (expected && expected.toLowerCase() !== instruction.memoData.toLowerCase()) {
      throw new Error(
        `Rebuilt memo does not match the one that was paid.\n` +
          `  paid:     ${expected}\n` +
          `  rebuilt:  ${instruction.memoData}\n` +
          "The rule parameters or the commitment differ from the payment. Fix them before retrying.",
      );
    }

    const proof = await fetchXrpPaymentProof({
      transactionId: normalizeTxId(xrplTx),
      proofOwner: account.address,
      ctx,
      say,
    });

    // Double the estimate. MasterAccountController catches each sub-call's
    // failure, so the estimator cannot see an inner call run out of gas, and
    // EIP-150 retains a sixty-fourth at each of the four nesting levels. See
    // the note in index.ts. Unused gas is refunded.
    const estimated = await publicClient.estimateContractGas({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "executeDirectMintingWithData",
      args: [proof as never, instruction.data],
      value: instruction.totalCallValue,
      account,
    });
    const gas = estimated * 2n > 1_500_000n ? estimated * 2n : 1_500_000n;

    say(`submitting executeDirectMintingWithData (gas ${gas}, estimate ${estimated})`);
    const hash = await walletClient.writeContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "executeDirectMintingWithData",
      args: [proof as never, instruction.data],
      value: instruction.totalCallValue,
      chain: coston2,
      account,
      gas,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`reverted: ${explorerTx(hash)}`);
    }

    const created = parseEventLogs({
      abi: ruleRegistryAbi,
      eventName: "RuleCreated",
      logs: receipt.logs,
    });
    const first = created[0];
    if (!first) {
      throw new Error(
        `No RuleCreated in ${explorerTx(hash)}. Check for DirectMintingDelayed: if the ` +
          "mint was rate limited, wait for executionAllowedAt and run this again.",
      );
    }

    console.log("\n  ---");
    console.log(`  RULE CREATED  ${first.args.ruleId as Hex}`);
    console.log(`  Flare tx      ${explorerTx(hash)}\n`);
  } finally {
    await xrplClient.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("\nfailed:", error);
  process.exit(1);
});
