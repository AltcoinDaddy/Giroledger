import { Client, type TransactionStream } from "xrpl";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assetManagerFxrpAbi,
  coston2,
  explorerTx,
  masterAccountControllerAbi,
  ruleRegistryAbi,
} from "@giroledger/shared";
import { loadConfig } from "./config.js";
import { logger, type Logger } from "./logger.js";
import { extractMemo, normaliseTxId } from "./handlePayment.js";
import { InstructionStore, memoUserOpHash, type PendingInstruction } from "./store.js";
import { startServer, type OperatorHealth } from "./server.js";
import {
  contractByName,
  fetchXrpPaymentProof,
  waitForXrplFinality,
  type CreateRuleContext,
} from "./createRule.js";

/**
 * The operator: completes payments that carry an instruction.
 *
 * WHAT IT WATCHES, AND WHY THAT WAS WRONG BEFORE. It subscribes to the FAssets
 * direct-minting payment address, read live from `AssetManagerFXRP`, because
 * that is where every instruction-carrying payment goes. The previous version
 * subscribed to `OPERATOR_XRPL_ADDRESS`, which is Flare's own public operator
 * wallet. It watched an account no user ever pays, so it had never fired once.
 *
 * WHY IT IS NEEDED AT ALL. Tested 28 July: a direct-minting payment nobody
 * follows up on sits at the Core Vault untouched. Flare's public operators do
 * not pick these up. Someone has to request the attestation and submit it, and
 * this is what does it.
 *
 * WHAT IT CANNOT DO. Forge an instruction. The memo the user signed commits to
 * one exact `keccak256(userOperation)`, and the FDC proof attests the payment
 * independently. The operator only supplies the operation body it was handed in
 * advance; substitute anything else and the hash disagrees and the chain
 * refuses it. Liveness critical, not safety critical.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const store = new InstructionStore(config.STATE_DIR);

  const publicClient = createPublicClient({
    chain: coston2,
    transport: http(config.COSTON2_RPC_URL),
  });
  const account = privateKeyToAccount(config.OPERATOR_PRIVATE_KEY as Hex);
  const walletClient = createWalletClient({
    account,
    chain: coston2,
    transport: http(config.COSTON2_RPC_URL),
  });

  const health: OperatorHealth = {
    startedAt: Date.now(),
    watching: null,
    seen: 0,
    completed: 0,
    failed: 0,
    lastError: null,
  };
  const assetManager = await contractByName(publicClient, "AssetManagerFXRP");
  const coreVault = (await publicClient.readContract({
    address: assetManager,
    abi: assetManagerFxrpAbi,
    functionName: "directMintingPaymentAddress",
  })) as string;

  const ctx: CreateRuleContext = {
    publicClient,
    walletClient,
    // The watcher never sends an XRPL payment. These exist only because
    // fetchXrpPaymentProof shares a context type with the sending path.
    xrplClient: null as never,
    xrplWallet: null as never,
    contracts: {
      fxrp: config.FXRP_ADDRESS as Address,
      ruleRegistry: config.RULE_REGISTRY_ADDRESS as Address,
      ruleExecutor: config.RULE_EXECUTOR_ADDRESS as Address,
    },
    verifier: {
      baseUrl: config.FDC_VERIFIER_URL,
      apiKey: config.FDC_VERIFIER_API_KEY,
    },
  };

  logger.info(
    { submitter: account.address, stored: store.size(), pending: store.pending().length },
    "operator starting",
  );

  const xrpl = new Client(config.XRPL_WSS_URL);
  await xrpl.connect();

  /*
   * Registering an instruction can complete a payment that already arrived.
   * Without this, the ordering "pay, then register" strands the XRP even though
   * the operator has everything it needs moments later.
   */
  startServer({
    port: config.OPERATOR_HTTP_PORT,
    store,
    health,
    log: logger,
    onRegistered: (pending) => {
      const orphan = store.takeOrphan(pending.userOpHash);
      if (!orphan) return;
      const log = logger.child({ xrplTx: orphan.xrplTx });
      log.info("this instruction matches a payment already waiting, completing now");
      health.seen += 1;
      void complete({
        pending,
        xrplTx: orphan.xrplTx,
        ctx,
        log,
        xrpl,
        assetManager,
        account,
        health,
        store,
      }).catch((e: unknown) => {
        health.failed += 1;
        health.lastError = e instanceof Error ? e.message : String(e);
        log.error({ err: health.lastError }, "failed to complete held payment");
      });
    },
  });
  await xrpl.request({ command: "subscribe", accounts: [coreVault] });
  health.watching = coreVault;
  logger.info({ coreVault }, "watching the direct-minting payment address");

  xrpl.on("transaction", (stream: TransactionStream) => {
    void (async () => {
      const tx = stream.tx_json;
      if (!tx || tx.TransactionType !== "Payment") return;
      if (stream.meta && typeof stream.meta !== "string") {
        if (stream.meta.TransactionResult !== "tesSUCCESS") return;
      }

      const xrplTx = stream.hash ?? "unknown";
      const log = logger.child({ xrplTx });

      const memo = extractMemo(tx as unknown as Record<string, unknown>);
      if (!memo) return;

      const userOpHash = memoUserOpHash(memo);
      if (!userOpHash) {
        log.debug("memo is not a 0xFE instruction, ignoring");
        return;
      }

      // The store is what makes this possible at all. Without a matching entry
      // the operator knows a payment wants something executed but not what.
      const pending = store.find(userOpHash);
      if (!pending) {
        // Remembered, not discarded. The instruction may still be on its way:
        // a user can pay before the browser finishes registering, and the
        // operator can be mid-restart. Recorded here, completed the moment the
        // matching instruction is handed over.
        store.recordOrphan(userOpHash, xrplTx);
        log.info(
          { userOpHash },
          "payment seen before its instruction. Held, will complete when handed over.",
        );
        return;
      }
      if (pending.completedTx !== undefined) {
        log.debug("already completed, ignoring");
        return;
      }

      health.seen += 1;
      try {
        await complete({ pending, xrplTx, ctx, log, xrpl, assetManager, account, health, store });
      } catch (e) {
        health.failed += 1;
        health.lastError = e instanceof Error ? e.message : String(e);
        log.error({ err: health.lastError }, "failed to complete payment");
      }
    })();
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await xrpl.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function complete(args: {
  pending: PendingInstruction;
  xrplTx: string;
  ctx: CreateRuleContext;
  log: Logger;
  xrpl: Client;
  assetManager: Address;
  account: ReturnType<typeof privateKeyToAccount>;
  health: OperatorHealth;
  store: InstructionStore;
}): Promise<void> {
  const { pending, xrplTx, ctx, log, xrpl, assetManager, account, health, store } = args;

  log.info({ userOpHash: pending.userOpHash }, "matched a stored instruction, completing");

  // Cheap replay check before spending an attestation round. The chain enforces
  // this too, but finding out here saves roughly two minutes.
  const mac = await contractByName(ctx.publicClient, "MasterAccountController");
  const used = await ctx.publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "isTransactionIdUsed",
    args: [normaliseTxId(xrplTx)],
  });
  if (used) {
    log.info("transaction already consumed on Flare, nothing to do");
    return;
  }

  await waitForXrplFinality(xrpl, xrplTx, (m) => log.info(m));

  const proof = await fetchXrpPaymentProof({
    transactionId: normaliseTxId(xrplTx),
    proofOwner: account.address,
    ctx,
    say: (m) => log.info(m),
  });

  const hash = await ctx.walletClient.writeContract({
    address: assetManager,
    abi: assetManagerFxrpAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof as never, pending.data],
    value: BigInt(pending.totalCallValue),
    chain: coston2,
    account,
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") {
    throw new Error(`executeDirectMintingWithData reverted: ${explorerTx(hash)}`);
  }

  const created = parseEventLogs({
    abi: ruleRegistryAbi,
    eventName: "RuleCreated",
    logs: receipt.logs,
  });
  const cancelled = parseEventLogs({
    abi: ruleRegistryAbi,
    eventName: "RuleCancelled",
    logs: receipt.logs,
  });

  store.markCompleted(pending.userOpHash, hash, xrplTx);
  health.completed += 1;

  log.info(
    {
      flareTx: explorerTx(hash),
      created: created[0]?.args.ruleId,
      cancelled: cancelled[0]?.args.ruleId,
    },
    "payment completed",
  );
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "operator failed to start");
  process.exit(1);
});
