import { z } from "zod";
import type { Address, Hex } from "viem";

/**
 * Rule trigger kinds. Must stay in sync with the `Trigger` enum in
 * contracts/src/RuleRegistry.sol. The numeric values are the on-chain encoding.
 */
export const Trigger = {
  TIME: 0,
  PRICE_BELOW: 1,
  PRICE_ABOVE: 2,
} as const;

export type TriggerValue = (typeof Trigger)[keyof typeof Trigger];

export const triggerLabel: Record<TriggerValue, string> = {
  [Trigger.TIME]: "On a schedule",
  [Trigger.PRICE_BELOW]: "When XRP falls below",
  [Trigger.PRICE_ABOVE]: "When XRP rises above",
};

/** Parameters a user supplies when creating a rule. */
export const createRuleParamsSchema = z
  .object({
    /** ERC-4626 vault the FXRP is deposited into. */
    vault: z.custom<Address>((v) => /^0x[a-fA-F0-9]{40}$/.test(String(v)), {
      message: "vault must be a 20 byte hex address",
    }),
    /** FXRP units moved per execution. */
    amountPerRun: z.bigint().positive(),
    /** Hard ceiling across the rule's whole life. Must equal the approved allowance. */
    totalSpendCap: z.bigint().positive(),
    /** Seconds between runs. Also acts as a cooldown for price triggers. */
    intervalSecs: z.number().int().min(60).max(31_536_000),
    /** 0 means "run until the cap is exhausted". */
    maxRuns: z.number().int().min(0).max(65_535),
    trigger: z.union([
      z.literal(Trigger.TIME),
      z.literal(Trigger.PRICE_BELOW),
      z.literal(Trigger.PRICE_ABOVE),
    ]),
    /** Unix seconds. 0 means "start now". */
    startAt: z.bigint().nonnegative(),
    /**
     * FTSO price threshold, scaled to the feed's own decimals.
     * Ignored when trigger is TIME.
     *
     * TODO(S-11): the XRP/USD feed reports its own decimals. Read them, do not
     * assume 18. See spec.md §5.3.
     */
    thresholdPrice: z.bigint(),
  })
  .refine((p) => p.totalSpendCap >= p.amountPerRun, {
    message: "totalSpendCap must be at least amountPerRun",
    path: ["totalSpendCap"],
  })
  .refine((p) => p.trigger === Trigger.TIME || p.thresholdPrice > 0n, {
    message: "price triggers need a positive thresholdPrice",
    path: ["thresholdPrice"],
  });

export type CreateRuleParams = z.infer<typeof createRuleParamsSchema>;

/** A rule as read back from RuleRegistry. */
export interface Rule {
  ruleId: Hex;
  account: Address;
  vault: Address;
  amountPerRun: bigint;
  totalSpendCap: bigint;
  totalSpent: bigint;
  nextRunAt: bigint;
  intervalSecs: number;
  maxRuns: number;
  runsDone: number;
  thresholdPrice: bigint;
  trigger: TriggerValue;
  active: boolean;
}

export interface RuleExecution {
  ruleId: Hex;
  account: Address;
  amount: bigint;
  sharesOut: bigint;
  at: bigint;
  txHash: Hex;
}

/** Derived view state for the UI. Never persisted. */
export type RuleStatus =
  | "pending"
  | "active"
  | "due"
  | "exhausted"
  | "cancelled";

/**
 * Exhaustion is checked BEFORE `active`, and the order matters.
 *
 * `RuleRegistry.markExecuted` sets `active = false` when a rule finishes its
 * last run, so a completed rule and a cancelled rule are both inactive on
 * chain. Checking `active` first labelled every successfully finished rule
 * "cancelled", which reads as a failure to anyone looking at the page.
 */
export function deriveStatus(rule: Rule, nowSecs: bigint): RuleStatus {
  const hitRunCap = rule.maxRuns > 0 && rule.runsDone >= rule.maxRuns;
  const hitSpendCap = rule.totalSpent + rule.amountPerRun > rule.totalSpendCap;
  if (hitRunCap || hitSpendCap) return "exhausted";
  if (!rule.active) return "cancelled";
  if (rule.nextRunAt > nowSecs) return "active";
  return "due";
}

export function remainingRuns(rule: Rule): number {
  const byCap = Number(
    (rule.totalSpendCap - rule.totalSpent) / rule.amountPerRun,
  );
  if (rule.maxRuns === 0) return byCap;
  return Math.min(byCap, rule.maxRuns - rule.runsDone);
}
