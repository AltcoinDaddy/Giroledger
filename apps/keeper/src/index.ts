import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2, ruleExecutorAbi, ruleRegistryAbi } from "@giroledger/shared";
import { loadConfig, type Config } from "./config.js";
import { logger } from "./logger.js";
import { backoffMs, classify } from "./errors.js";

interface Health {
  startedAt: number;
  lastTickAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  pendingDue: number;
  executed: number;
  quarantined: number;
  consecutiveFailures: number;
}

const health: Health = {
  startedAt: Date.now(),
  lastTickAt: null,
  lastSuccessAt: null,
  lastError: null,
  pendingDue: 0,
  executed: 0,
  quarantined: 0,
  consecutiveFailures: 0,
};

/**
 * Rules that failed for a reason that will never resolve. Kept out of every
 * subsequent batch so one dead rule cannot burn gas forever, and logged once
 * rather than every thirty seconds.
 */
const quarantine = new Map<Hex, string>();

/**
 * Rules submitted in a batch that produced no `Deposited` event. Counted rather
 * than acted on immediately, because one no-op can be a genuine race with the
 * interval boundary. Several in a row cannot.
 */
const noopStrikes = new Map<Hex, number>();

async function main(): Promise<void> {
  const config = loadConfig();

  const publicClient = createPublicClient({
    chain: coston2,
    transport: http(config.COSTON2_RPC_URL),
  });
  const account = privateKeyToAccount(config.KEEPER_PRIVATE_KEY as Hex);
  const walletClient = createWalletClient({
    account,
    chain: coston2,
    transport: http(config.COSTON2_RPC_URL),
  });

  logger.info(
    {
      keeper: account.address,
      registry: config.RULE_REGISTRY_ADDRESS,
      executor: config.RULE_EXECUTOR_ADDRESS,
      pollMs: config.POLL_INTERVAL_MS,
    },
    "keeper starting",
  );

  startHealthServer(config.HEALTH_PORT);

  let running = true;
  const stop = (signal: string): void => {
    logger.info({ signal }, "shutting down after the current tick");
    running = false;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  let failures = 0;

  while (running) {
    health.lastTickAt = Date.now();
    try {
      await tick({ config, publicClient, walletClient });
      health.lastSuccessAt = Date.now();
      health.lastError = null;
      health.consecutiveFailures = 0;
      failures = 0;
    } catch (error) {
      const { kind, reason } = classify(error);
      failures += 1;
      health.consecutiveFailures = failures;
      health.lastError = `${kind}: ${reason}`;
      logger.error({ kind, reason }, "tick failed");
    }

    // Back off after repeated failures instead of hammering a broken RPC.
    const wait = failures > 0 ? backoffMs(failures, config.POLL_INTERVAL_MS) : config.POLL_INTERVAL_MS;
    await sleep(wait);
  }

  process.exit(0);
}

interface Ctx {
  config: Config;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

async function tick(ctx: Ctx): Promise<void> {
  const { config, publicClient, walletClient } = ctx;

  const allDue = await collectDue(ctx);
  health.pendingDue = allDue.length;

  if (allDue.length === 0) {
    logger.debug("nothing due");
    return;
  }

  // Budgeting gas explicitly means a batch can outgrow the block gas limit.
  // Trim to fit; the remainder is still due next tick.
  const maxByGas = Number((config.MAX_TX_GAS - config.GAS_BATCH_OVERHEAD) / config.GAS_PER_RULE);
  const due = allDue.length > maxByGas ? allDue.slice(0, Math.max(1, maxByGas)) : allDue;
  if (due.length < allDue.length) {
    logger.info({ taking: due.length, of: allDue.length }, "batch trimmed to fit the gas ceiling");
  }

  const account = walletClient.account;
  if (!account) throw new Error("wallet client has no account");

  // One rule due: call `execute` directly and skip the batch path entirely.
  //
  // `executeBatch` caps each inner call at RuleExecutor.GAS_PER_RULE, because a
  // try/catch has to bound what it is willing to lose. `execute` has no such
  // cap: it gets the whole transaction's gas. Measured on Coston2, a Firelight
  // deposit costs ~470k against that 600k on-chain cap, which is thinner
  // headroom than any vault deserves. Batching is a throughput optimisation and
  // this is the case where it buys nothing, so do not pay its ceiling.
  if (due.length === 1) {
    await executeSingle(ctx, due[0]!);
    return;
  }

  logger.info({ count: due.length }, "submitting batch");

  // Budget the gas ourselves. See GAS_PER_RULE in config.ts: `eth_estimateGas`
  // cannot see inside `executeBatch`'s try/catch and will happily under-fund
  // the inner call, which then reverts silently and is caught.
  const gas = BigInt(due.length) * config.GAS_PER_RULE + config.GAS_BATCH_OVERHEAD;

  // Simulate at exactly the gas we intend to send, and read the return value.
  // `succeeded` is the number of rules that will actually execute. The receipt
  // status cannot tell us this, because the batch succeeds either way.
  const { request, result } = await publicClient.simulateContract({
    address: config.RULE_EXECUTOR_ADDRESS as Hex,
    abi: ruleExecutorAbi,
    functionName: "executeBatch",
    args: [due],
    account,
    gas,
  });

  const willSucceed = result;
  if (willSucceed === 0n) {
    // Sending this would burn gas to accomplish nothing. Do not send it.
    logger.warn({ count: due.length, gas: gas.toString() }, "batch would execute nothing, not sending");
    for (const id of due) strike(ctx, id, "batch simulated with succeeded = 0");
    await quarantineStillDue(ctx, due);
    return;
  }
  if (willSucceed < BigInt(due.length)) {
    logger.warn(
      { willSucceed: willSucceed.toString(), submitted: due.length },
      "some rules in this batch will be skipped",
    );
  }

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`batch reverted on-chain: ${hash}`);
  }

  // The receipt says "success" even when every inner call was caught. The
  // events are the only honest record of what happened.
  const logs = parseEventLogs({ abi: ruleExecutorAbi, logs: receipt.logs });
  const deposited = new Set<Hex>();
  const skipped: Hex[] = [];
  for (const log of logs) {
    if (log.eventName === "Deposited") deposited.add(log.args.ruleId);
    else if (log.eventName === "ExecutionSkipped") skipped.push(log.args.ruleId);
  }

  for (const id of due) {
    if (deposited.has(id)) noopStrikes.delete(id);
    else strike(ctx, id, "submitted but emitted no Deposited event");
  }

  health.executed += deposited.size;
  logger.info(
    {
      hash,
      gasUsed: receipt.gasUsed.toString(),
      gasLimit: gas.toString(),
      deposited: deposited.size,
      skipped: skipped.length,
      quarantined: quarantine.size,
    },
    deposited.size > 0 ? "batch executed" : "batch executed nothing",
  );

  if (skipped.length > 0) await quarantineStillDue(ctx, skipped);
}

/**
 * Execute exactly one rule, uncapped.
 *
 * Reverts here are honest: `execute` is not wrapped in a try/catch, so a
 * failure reverts the transaction and the simulation catches it before any gas
 * is spent. That is the opposite of the batch path, where a failure is caught
 * and reported as success.
 */
async function executeSingle(ctx: Ctx, ruleId: Hex): Promise<void> {
  const { config, publicClient, walletClient } = ctx;
  const account = walletClient.account;
  if (!account) throw new Error("wallet client has no account");

  logger.info({ ruleId }, "executing one rule");

  let request;
  try {
    ({ request } = await publicClient.simulateContract({
      address: config.RULE_EXECUTOR_ADDRESS as Hex,
      abi: ruleExecutorAbi,
      functionName: "execute",
      args: [ruleId],
      account,
      gas: config.GAS_PER_RULE + config.GAS_BATCH_OVERHEAD,
    }));
  } catch (error) {
    // Nothing was sent, so this cost nothing. Classify and move on.
    const { kind, reason } = classify(error);
    if (kind === "permanent") {
      quarantine.set(ruleId, reason);
      health.quarantined = quarantine.size;
      logger.warn({ ruleId, reason }, "rule quarantined, will not be retried");
    } else {
      strike(ctx, ruleId, `execute simulation failed: ${reason}`);
    }
    return;
  }

  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`execute reverted on-chain: ${hash}`);
  }

  const logs = parseEventLogs({ abi: ruleExecutorAbi, logs: receipt.logs });
  const deposited = logs.some((l) => l.eventName === "Deposited");

  if (deposited) {
    noopStrikes.delete(ruleId);
    health.executed += 1;
  } else {
    // A successful receipt with no Deposited event should be impossible on this
    // path, since `_execute` emits it unconditionally. Record it rather than
    // assume, because that assumption is what cost us thirty-two minutes.
    strike(ctx, ruleId, "execute succeeded but emitted no Deposited event");
  }

  logger.info(
    { hash, ruleId, gasUsed: receipt.gasUsed.toString(), deposited, quarantined: quarantine.size },
    deposited ? "executed" : "executed nothing",
  );
}

/**
 * Record that a rule failed to produce a deposit. Quarantine it once it has
 * done so repeatedly, whatever the simulator claims.
 *
 * This exists because the previous version trusted `simulateContract` alone:
 * `execute` simulated cleanly, so the rule was judged transient and retried
 * every thirty seconds. Sixty times. What the simulator says and what the chain
 * does are different questions, and only the second one matters.
 */
function strike(ctx: Ctx, ruleId: Hex, reason: string): void {
  const n = (noopStrikes.get(ruleId) ?? 0) + 1;
  noopStrikes.set(ruleId, n);
  if (n < ctx.config.MAX_NOOP_STRIKES) {
    logger.debug({ ruleId, strikes: n, reason }, "rule did not execute");
    return;
  }
  quarantine.set(ruleId, `${reason} (${n} consecutive times)`);
  health.quarantined = quarantine.size;
  logger.warn({ ruleId, strikes: n, reason }, "rule quarantined after repeated no-ops");
}

/** Page through due rules, skipping anything quarantined. */
async function collectDue(ctx: Ctx): Promise<Hex[]> {
  const { config, publicClient } = ctx;
  const out: Hex[] = [];
  let offset = 0n;

  for (;;) {
    const [ids, nextOffset] = (await publicClient.readContract({
      address: config.RULE_REGISTRY_ADDRESS as Hex,
      abi: ruleRegistryAbi,
      functionName: "dueRules",
      args: [offset, 100n],
    })) as readonly [readonly Hex[], bigint];

    for (const id of ids) {
      if (quarantine.has(id)) continue;
      out.push(id);
      if (out.length >= config.MAX_BATCH_SIZE) return out;
    }

    if (nextOffset <= offset) break; // no progress, stop rather than spin
    offset = nextOffset;

    const total = await publicClient.readContract({
      address: config.RULE_REGISTRY_ADDRESS as Hex,
      abi: ruleRegistryAbi,
      functionName: "totalRules",
    });
    if (offset >= total) break;
  }

  return out;
}

/**
 * Find out why a rule survived a batch. Simulating `execute` on it surfaces the
 * custom error without spending gas.
 */
async function quarantineStillDue(ctx: Ctx, submitted: readonly Hex[]): Promise<void> {
  const { config, publicClient, walletClient } = ctx;
  const account = walletClient.account;
  if (!account) return;

  for (const id of submitted) {
    const stillDue = await publicClient.readContract({
      address: config.RULE_REGISTRY_ADDRESS as Hex,
      abi: ruleRegistryAbi,
      functionName: "isDue",
      args: [id],
    });
    if (!stillDue) continue;

    try {
      await publicClient.simulateContract({
        address: config.RULE_EXECUTOR_ADDRESS as Hex,
        abi: ruleExecutorAbi,
        functionName: "execute",
        args: [id],
        account,
        gas: config.GAS_PER_RULE,
      });
      // Simulates fine yet did not execute. Do NOT conclude "transient" and
      // move on: that is exactly the branch that let the keeper spin for
      // thirty-two minutes. The strike counter will retire it if it persists.
      logger.warn(
        { ruleId: id },
        "rule simulates cleanly but did not execute, suspect gas starvation in the batch",
      );
    } catch (error) {
      const { kind, reason } = classify(error);
      if (kind === "permanent") {
        quarantine.set(id, reason);
        health.quarantined = quarantine.size;
        logger.warn({ ruleId: id, reason }, "rule quarantined, will not be retried");
      } else {
        logger.debug({ ruleId: id, reason }, "rule skipped, transient");
      }
    }
  }
}

function startHealthServer(port: number): void {
  createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const stale =
      health.lastSuccessAt !== null && Date.now() - health.lastSuccessAt > 5 * 60_000;
    const ok = !stale && health.consecutiveFailures < 5;
    res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        {
          ok,
          ...health,
          quarantinedRules: Object.fromEntries(quarantine),
          uptimeSeconds: Math.floor((Date.now() - health.startedAt) / 1000),
        },
        null,
        2,
      ),
    );
  }).listen(port, () => logger.info({ port }, "health endpoint listening"));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "keeper failed to start");
  process.exit(1);
});
