import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * A keeper that retries everything forever is a keeper that burns gas on a
 * rule which will never be executable, and hides the reason in a log flood.
 *
 * Transient  -> retry next tick. Network, nonce races, gas, temporary pause.
 * Permanent  -> stop trying. The rule is cancelled, exhausted, out of allowance
 *               or otherwise dead. Log once, loudly, and move on.
 */
export type FailureKind = "transient" | "permanent";

/** Errors from RuleRegistry and RuleExecutor that will never resolve on retry. */
const PERMANENT_ERRORS = new Set([
  "RuleNotActive",
  "CapExceeded",
  "UnknownRule",
  "VaultNotAllowed",
  "InvalidParams",
  "TriggerNotEnabled",
  "NotAccount",
  "NotExecutor",
  "NotSelf",
  // ERC-20: the user revoked or exhausted the allowance. Nothing we can do.
  "ERC20InsufficientAllowance",
  "ERC20InsufficientBalance",
]);

/**
 * Errors that resolve on their own.
 *
 * `RuleNotDue` is transient by definition: it becomes due when the interval
 * elapses. `IsPaused` is transient because the owner can unpause.
 */
const TRANSIENT_ERRORS = new Set(["RuleNotDue", "IsPaused", "ResidualBalance"]);

export interface Classified {
  kind: FailureKind;
  reason: string;
}

export function classify(error: unknown): Classified {
  const name = revertName(error);

  if (name) {
    if (PERMANENT_ERRORS.has(name)) return { kind: "permanent", reason: name };
    if (TRANSIENT_ERRORS.has(name)) return { kind: "transient", reason: name };
    // An unrecognised custom error is more likely a contract change than a
    // blip. Treat it as permanent so it surfaces instead of looping quietly.
    return { kind: "permanent", reason: `unrecognised revert: ${name}` };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/nonce|replacement|underpriced|timeout|ECONN|fetch failed|429|502|503/i.test(message)) {
    return { kind: "transient", reason: message.slice(0, 200) };
  }

  return { kind: "transient", reason: message.slice(0, 200) };
}

function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? null;
  }
  return null;
}

/** Exponential backoff with jitter, so restarts do not synchronise. */
export function backoffMs(attempt: number, baseMs = 1_000, capMs = 60_000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}
