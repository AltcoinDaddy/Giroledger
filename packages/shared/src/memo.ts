import { encodeFunctionData, type Address, type Hex } from "viem";
import { erc20Abi, ruleRegistryAbi } from "./abi.js";
import type { CreateRuleParams } from "./types.js";
import {
  encodeHashInstructionMemo,
  type Call,
  type HashInstructionMemo,
} from "./smartAccount.js";

/**
 * Turning a GiroLedger rule into an XRPL payment.
 *
 * Two layers, and it matters which is which:
 *
 *   OUTER, not ours - the Flare Smart Accounts memo. Opcode `0xFE`, a fixed
 *     42 bytes: `0xFE | walletId | executorFeeUBA | keccak256(userOp)`.
 *     Implemented in `smartAccount.ts`, verified against a real on-chain
 *     execution.
 *
 *   INNER, ours - the batch of calls the personal account runs. That is this
 *     file: approve the executor for exactly the cap, then create the rule.
 *
 * Both layers are now proven. The `0xFE` encoding reproduces the hash from the
 * transaction that first worked on Coston2 (see `smartAccount.test.ts`), and
 * the inner calldata round-trips through `decodeFunctionData` in `memo.test.ts`.
 */

export type { Call } from "./smartAccount.js";

/** Flare Smart Accounts memo opcodes. */
export const MemoOpcode = {
  /** keccak256(PackedUserOperation) only. 42 bytes, batch-size independent. */
  CUSTOM_INSTRUCTION_HASH: 0xfe,
  /** Full user operation inline. Overflows the 1024-byte XRPL memo cap quickly. */
  CUSTOM_INSTRUCTION_INLINE: 0xff,
} as const;

export interface ContractSet {
  /** FXRP on Coston2. */
  fxrp: Address;
  ruleRegistry: Address;
  ruleExecutor: Address;
}

/* -------------------------------------------------------------- our calls -- */

/**
 * The two calls that create a rule.
 *
 * Order matters. The allowance is granted first, so the executor never needs to
 * call back into the personal account at execution time. Execution becomes a
 * plain `transferFrom` bounded by an on-chain cap. See spec.md §3.1.
 *
 * THE ALLOWANCE IS SHARED BY EVERY RULE ON THE ACCOUNT. There is one ERC-20
 * approval per (owner, spender) pair, and `approve` sets it absolutely rather
 * than increasing it. An earlier version passed `params.totalSpendCap` here,
 * which meant creating a second rule silently overwrote the first rule's
 * headroom and the first rule stopped executing.
 *
 * So the caller must pass `otherActiveCommitment`: the sum of
 * `totalSpendCap - totalSpent` across every OTHER active rule on this account,
 * read fresh from the registry at memo-build time, exactly like the nonce.
 *
 * This was never a funds-at-risk bug. `RuleRegistry.markExecuted` enforces each
 * rule's own cap independently, so no rule can exceed its ceiling whatever the
 * allowance says. The allowance is a second, coarser bound. Getting it wrong
 * breaks liveness, not safety.
 */
export function buildCreateRuleCalls(
  params: CreateRuleParams,
  contracts: ContractSet,
  otherActiveCommitment = 0n,
): Call[] {
  if (otherActiveCommitment < 0n) {
    throw new Error("otherActiveCommitment cannot be negative");
  }
  return [
    {
      target: contracts.fxrp,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [contracts.ruleExecutor, params.totalSpendCap + otherActiveCommitment],
      }),
    },
    {
      target: contracts.ruleRegistry,
      value: 0n,
      data: encodeFunctionData({
        abi: ruleRegistryAbi,
        functionName: "createRule",
        args: [
          {
            vault: params.vault,
            amountPerRun: params.amountPerRun,
            totalSpendCap: params.totalSpendCap,
            intervalSecs: params.intervalSecs,
            maxRuns: params.maxRuns,
            trigger: params.trigger,
            startAt: params.startAt,
            thresholdPrice: params.thresholdPrice,
          },
        ],
      }),
    },
  ];
}

/**
 * Cancel: kill the rule, then reduce the allowance to what the account's OTHER
 * active rules still need.
 *
 * `remainingCommitment` is the sum of `totalSpendCap - totalSpent` across every
 * still-active rule EXCLUDING the one being cancelled. Pass 0 when this is the
 * account's only rule, which revokes the approval entirely.
 *
 * An earlier version always approved 0. That is correct for a single rule and
 * wrong the moment there are two: cancelling one rule zeroed the shared
 * allowance and every other rule on the account silently stopped executing.
 * Found on Coston2, where cancelling one rule left another sitting DUE with
 * eight runs remaining and no way to draw them.
 *
 * Cancel still tightens rather than loosens: it can only ever lower the
 * allowance, because the cancelled rule's own remainder is excluded from the
 * sum. There is no ordering in which this grants more headroom than existed.
 */
export function buildCancelRuleCalls(
  ruleId: Hex,
  contracts: ContractSet,
  remainingCommitment = 0n,
): Call[] {
  if (remainingCommitment < 0n) {
    throw new Error("remainingCommitment cannot be negative");
  }
  return [
    {
      target: contracts.ruleRegistry,
      value: 0n,
      data: encodeFunctionData({
        abi: ruleRegistryAbi,
        functionName: "cancelRule",
        args: [ruleId],
      }),
    },
    {
      target: contracts.fxrp,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [contracts.ruleExecutor, remainingCommitment],
      }),
    },
  ];
}

/* ------------------------------------------------------- the whole payload -- */

/**
 * Everything needed to send one rule-creating XRPL payment.
 *
 * `memoData` goes in the XRPL memo. `data` is handed to the executor off-chain
 * and never touches the XRPL ledger.
 *
 * IMPORTANT: read `nonce` fresh from `getNonce(personalAccount)` immediately
 * before calling this. Two payments built from the same nonce collide, the
 * second reverts with `InvalidNonce`, and its XRP is stranded at the Core Vault.
 */
export function buildCreateRuleInstruction(args: {
  params: CreateRuleParams;
  contracts: ContractSet;
  personalAccount: Address;
  nonce: bigint;
  /**
   * Sum of `totalSpendCap - totalSpent` over the account's other ACTIVE rules.
   * Read it with `sumActiveCommitment` immediately before building, alongside
   * the nonce. Omitting it on an account that already has active rules will
   * stop those rules dead. See `buildCreateRuleCalls`.
   */
  otherActiveCommitment?: bigint;
}): HashInstructionMemo & { calls: Call[] } {
  const calls = buildCreateRuleCalls(
    args.params,
    args.contracts,
    args.otherActiveCommitment ?? 0n,
  );
  return {
    calls,
    ...encodeHashInstructionMemo({
      calls,
      sender: args.personalAccount,
      nonce: args.nonce,
    }),
  };
}

export function buildCancelRuleInstruction(args: {
  ruleId: Hex;
  contracts: ContractSet;
  personalAccount: Address;
  nonce: bigint;
  /**
   * Sum of `totalSpendCap - totalSpent` over the account's other ACTIVE rules,
   * excluding the one being cancelled. Defaults to 0, which revokes the
   * approval outright. Correct only when this is the account's sole rule.
   */
  remainingCommitment?: bigint;
}): HashInstructionMemo & { calls: Call[] } {
  const calls = buildCancelRuleCalls(
    args.ruleId,
    args.contracts,
    args.remainingCommitment ?? 0n,
  );
  return {
    calls,
    ...encodeHashInstructionMemo({
      calls,
      sender: args.personalAccount,
      nonce: args.nonce,
    }),
  };
}

/**
 * How much the account's active rules can still draw, in total.
 *
 * This is the number both instruction builders need, and computing it in one
 * place is the point: an allowance derived from a partial view of the rule list
 * is how rules end up silently starved.
 *
 * @param rules  Every rule on the account, active or not.
 * @param exclude  A rule to leave out, when building a cancel instruction.
 */
export function sumActiveCommitment(
  rules: readonly {
    ruleId: Hex;
    active: boolean;
    totalSpendCap: bigint;
    totalSpent: bigint;
  }[],
  exclude?: Hex,
): bigint {
  let total = 0n;
  for (const r of rules) {
    if (!r.active) continue;
    if (exclude !== undefined && r.ruleId.toLowerCase() === exclude.toLowerCase()) continue;
    // Defensive: markExecuted forbids overspend, so this cannot go negative on
    // chain. Clamping means a corrupt read cannot produce a negative approval.
    const remaining = r.totalSpendCap > r.totalSpent ? r.totalSpendCap - r.totalSpent : 0n;
    total += remaining;
  }
  return total;
}

/* ------------------------------------------------------------ XRPL memos -- */

/** XRPL memo fields are uppercase hex with no 0x prefix. */
export function toXrplHex(data: Hex | string): string {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  return raw.toUpperCase();
}

export function fromXrplHex(hex: string): Hex {
  return `0x${hex.toLowerCase()}` as Hex;
}

export interface XrplMemo {
  Memo: { MemoData: string; MemoType?: string; MemoFormat?: string };
}

export function buildXrplMemo(payload: Hex): XrplMemo {
  return { Memo: { MemoData: toXrplHex(payload) } };
}

/**
 * XRPL memo cap. The `0xFE` form is 42 bytes so it never approaches this, but
 * the constant documents why the inline `0xFF` form was rejected: the
 * three-call demo user operation encodes to 1216 bytes.
 */
export const XRPL_MEMO_CAP_BYTES = 1024;

export function payloadFitsInline(payload: Hex): boolean {
  return (payload.length - 2) / 2 <= XRPL_MEMO_CAP_BYTES;
}

/**
 * XRPL payments to smart accounts must NOT carry a destination tag.
 *
 * A tag makes FAssets credit the tag holder, which would let an unrelated party
 * front-run the user's operation. Source: the custom-instruction guide.
 */
export const DESTINATION_TAG_FORBIDDEN = true;
