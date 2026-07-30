/**
 * Why does `RuleExecutor.execute` revert?
 *
 *   RULE_ID=0xbae7... pnpm --filter @giroledger/operator simulate-execute
 *
 * `executeBatch` swallows individual reverts by design, so the keeper cannot
 * tell us. This simulates the real call and then, if it fails, walks the three
 * interactions one at a time to find which one is the blocker.
 *
 * Read-only. Nothing here sends a transaction.
 */
import {
  createPublicClient,
  decodeErrorResult,
  formatUnits,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import {
  coston2,
  erc20Abi,
  erc4626Abi,
  ruleExecutorAbi,
  ruleRegistryAbi,
} from "@giroledger/shared";

/** Every custom error we might plausibly see, in one place for decoding. */
const errorAbi = parseAbi([
  // RuleRegistry
  "error NotAccount()",
  "error NotExecutor()",
  "error RuleNotActive()",
  "error RuleNotDue()",
  "error CapExceeded()",
  "error VaultNotAllowed()",
  "error InvalidParams()",
  "error TriggerNotEnabled()",
  "error PageTooLarge()",
  "error UnknownRule()",
  // RuleExecutor
  "error IsPaused()",
  "error NotSelf()",
  "error BatchTooLarge()",
  "error NothingDue()",
  "error ResidualBalance()",
  // OpenZeppelin
  "error OwnableUnauthorizedAccount(address)",
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address)",
  "error ERC20InsufficientBalance(address,uint256,uint256)",
  "error ERC20InsufficientAllowance(address,uint256,uint256)",
  "error ERC4626ExceededMaxDeposit(address,uint256,uint256)",
  "error AddressInsufficientBalance(address)",
]);

const req = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} not set`);
  return v;
};

/** Pull the 4-byte selector or Error(string) out of whatever viem hands back. */
function explain(err: unknown): string {
  const s = err instanceof Error ? `${err.message}` : String(err);
  const m = /0x[0-9a-fA-F]{8,}/.exec(s);
  if (m) {
    const data = m[0] as Hex;
    try {
      const d = decodeErrorResult({ abi: errorAbi as Abi, data });
      return `${d.errorName}(${(d.args ?? []).join(", ")})   [raw ${data.slice(0, 10)}]`;
    } catch {
      return `undecoded revert ${data.slice(0, 10)}\n      full: ${data.slice(0, 200)}`;
    }
  }
  return s.split("\n").slice(0, 4).join("\n      ");
}

async function try_(label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const out = await fn();
    console.log(`  OK    ${label}${out === undefined ? "" : ` -> ${String(out)}`}`);
    return true;
  } catch (e) {
    console.log(`  FAIL  ${label}\n      ${explain(e)}`);
    return false;
  }
}

/**
 * The gas-estimation trap in `executeBatch`.
 *
 * `try this.executeOne(id) {} catch {}` means the OUTER call succeeds even when
 * the INNER call runs out of gas. `eth_estimateGas` binary-searches for the
 * lowest gas at which the outer call succeeds, so it happily returns a figure
 * that starves the inner call. The inner call OOGs, gets caught, and the batch
 * reports success having done nothing. Forever.
 *
 * If `estimateGas(executeBatch)` comes back materially BELOW
 * `estimateGas(execute)`, that is the bug, in one number.
 */
async function batchGasReport(
  client: ReturnType<typeof createPublicClient>,
  executor: Address,
  ruleId: Hex,
  caller: Address,
): Promise<void> {
  console.log("\n3. Gas: executeBatch([id]) versus execute(id)");

  let single = 0n;
  let batch = 0n;

  await try_("estimateGas execute(id)", async () => {
    single = await client.estimateContractGas({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "execute",
      args: [ruleId],
      account: caller,
    });
    return `${single} gas`;
  });

  await try_("estimateGas executeBatch([id])", async () => {
    batch = await client.estimateContractGas({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "executeBatch",
      args: [[ruleId]],
      account: caller,
    });
    return `${batch} gas`;
  });

  // How many rules does the batch claim to have executed, given plenty of gas?
  await try_("simulate executeBatch([id]) with generous gas -> succeeded", async () => {
    const sim = await client.simulateContract({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "executeBatch",
      args: [[ruleId]],
      account: caller,
      gas: 5_000_000n,
    });
    return `succeeded = ${String(sim.result)} (1 means it works when not starved)`;
  });

  // And at the gas the keeper actually spent.
  await try_("simulate executeBatch([id]) at the keeper's 316693 gas -> succeeded", async () => {
    const sim = await client.simulateContract({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "executeBatch",
      args: [[ruleId]],
      account: caller,
      gas: 316_693n,
    });
    return `succeeded = ${String(sim.result)} (0 means starved, and this is the bug)`;
  });

  console.log("\n  --- verdict ---");
  if (single > 0n && batch > 0n && batch < single) {
    console.log(`  CONFIRMED. The batch estimate (${batch}) is BELOW the single-rule`);
    console.log(`  estimate (${single}). estimateGas cannot see inside a try/catch, so`);
    console.log("  it under-funds the inner call. The inner call runs out of gas, the");
    console.log("  catch swallows it, and the batch reports success having done nothing.");
  } else {
    console.log(`  single ${single}, batch ${batch}. Not the gas trap.`);
    console.log("  Compare the two `succeeded` lines above instead.");
  }
  console.log();
}

async function main(): Promise<void> {
  const client = createPublicClient({
    chain: coston2,
    transport: http(process.env["COSTON2_RPC_URL"] ?? coston2.rpcUrls.default.http[0]!),
  });

  const registry = req("RULE_REGISTRY_ADDRESS") as Address;
  const executor = req("RULE_EXECUTOR_ADDRESS") as Address;
  const fxrp = req("FXRP_ADDRESS") as Address;
  const ruleId = req("RULE_ID") as Hex;
  const caller = (process.env["KEEPER_ADDRESS"] ?? executor) as Address;

  const r = await client.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "getRule",
    args: [ruleId],
  });
  const dec = await client.readContract({ address: fxrp, abi: erc20Abi, functionName: "decimals" });
  const amount = r.amountPerRun;

  console.log(`\nSimulating rule ${ruleId}`);
  console.log(`  amountPerRun   ${formatUnits(amount, dec)} FXRP (${amount} raw)`);
  console.log(`  vault          ${r.vault}`);
  console.log(`  caller         ${caller}\n`);

  // ---- 1. the whole thing, exactly as the keeper calls it ------------------
  console.log("1. RuleExecutor.execute(ruleId)");
  const wholeOk = await try_("execute", async () => {
    await client.simulateContract({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "execute",
      args: [ruleId],
      account: caller,
    });
    return undefined;
  });

  if (wholeOk) {
    console.log("\n  execute() is fine on its own. So the batch path is the problem.");
    await batchGasReport(client, executor, ruleId, caller);
    return;
  }

  // ---- 2. each interaction on its own --------------------------------------
  console.log("\n2. Walking the three interactions as the executor contract");

  await try_("paused?", async () => {
    const p = await client.readContract({
      address: executor,
      abi: ruleExecutorAbi,
      functionName: "paused",
    });
    return `paused = ${p}`;
  });

  await try_("registry.markExecuted(ruleId, amount)", async () => {
    await client.simulateContract({
      address: registry,
      abi: ruleRegistryAbi,
      functionName: "markExecuted",
      args: [ruleId, amount],
      account: executor,
    });
    return undefined;
  });

  await try_("FXRP.transferFrom(account, executor, amount)", async () => {
    const ok = await client.simulateContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "transferFrom",
      args: [r.account, executor, amount],
      account: executor,
    });
    return `returned ${String(ok.result)}`;
  });

  await try_("vault.asset()", async () => {
    const a = await client.readContract({
      address: r.vault,
      abi: erc4626Abi,
      functionName: "asset",
    });
    return `${a}${a.toLowerCase() === fxrp.toLowerCase() ? " (matches FXRP)" : " (!! NOT FXRP)"}`;
  });

  await try_("vault.maxDeposit(account)", async () => {
    const m = await client.readContract({
      address: r.vault,
      abi: erc4626Abi,
      functionName: "maxDeposit",
      args: [r.account],
    });
    return `${formatUnits(m, dec)} FXRP`;
  });

  await try_("vault.previewDeposit(amount)", async () => {
    const s = await client.readContract({
      address: r.vault,
      abi: erc4626Abi,
      functionName: "previewDeposit",
      args: [amount],
    });
    return `${s} shares`;
  });

  await try_("vault.deposit(amount, account)  [executor holds 0, expect a balance error]", async () => {
    await client.simulateContract({
      address: r.vault,
      abi: erc4626Abi,
      functionName: "deposit",
      args: [amount, r.account],
      account: executor,
    });
    return undefined;
  });

  console.log("\n  Read it top down. The first FAIL that is not the last line is the cause.");
  console.log("  The last line is expected to fail: the executor is empty outside a tx.\n");
}

main().catch((e: unknown) => {
  console.error("failed:", e);
  process.exit(1);
});
