import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";

import {
  createRuleParamsSchema,
  deriveStatus,
  remainingRuns,
  Trigger,
  type Rule,
} from "./types.js";

const NOW = 1_800_000_000n;

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    ruleId: `0x${"11".repeat(32)}` as Hex,
    account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
    vault: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
    amountPerRun: 10n,
    totalSpendCap: 50n,
    totalSpent: 0n,
    nextRunAt: NOW - 1n,
    intervalSecs: 3600,
    maxRuns: 5,
    runsDone: 0,
    thresholdPrice: 0n,
    trigger: Trigger.TIME,
    active: true,
    ...overrides,
  };
}

describe("deriveStatus", () => {
  it("is due when active and the next run has passed", () => {
    assert.equal(deriveStatus(rule(), NOW), "due");
  });

  it("is active while waiting for the interval", () => {
    assert.equal(deriveStatus(rule({ nextRunAt: NOW + 3600n }), NOW), "active");
  });

  it("is cancelled when inactive", () => {
    assert.equal(deriveStatus(rule({ active: false }), NOW), "cancelled");
  });

  it("is exhausted at maxRuns even with cap remaining", () => {
    const r = rule({ runsDone: 5, maxRuns: 5, totalSpent: 10n });
    assert.equal(deriveStatus(r, NOW), "exhausted");
  });

  it("is exhausted when one more run would breach the cap", () => {
    // 45 spent, 10 per run, 50 cap: the next run does not fit.
    const r = rule({ totalSpent: 45n, maxRuns: 0 });
    assert.equal(deriveStatus(r, NOW), "exhausted");
  });

  it("is still due when the next run exactly fits the cap", () => {
    const r = rule({ totalSpent: 40n, maxRuns: 0 });
    assert.equal(deriveStatus(r, NOW), "due", "exact fit must not be treated as exhausted");
  });

  /**
   * This assertion used to be the other way round, and it was wrong.
   *
   * `markExecuted` deactivates a rule the moment it completes its final run, so
   * a finished rule is indistinguishable from a cancelled one by the `active`
   * flag alone. Preferring "cancelled" meant the UI labelled five successful
   * runs out of five as cancelled, which reads as a failure.
   */
  it("prefers exhausted over cancelled, because finishing deactivates a rule", () => {
    const r = rule({ active: false, runsDone: 5, maxRuns: 5 });
    assert.equal(deriveStatus(r, NOW), "exhausted");
  });

  it("still reports cancelled when a rule is stopped before it finishes", () => {
    const r = rule({ active: false, runsDone: 2, maxRuns: 5, totalSpent: 20n });
    assert.equal(deriveStatus(r, NOW), "cancelled");
  });
});

describe("remainingRuns", () => {
  it("is bounded by the cap when maxRuns is unlimited", () => {
    assert.equal(remainingRuns(rule({ maxRuns: 0 })), 5);
  });

  it("is bounded by maxRuns when that binds first", () => {
    assert.equal(remainingRuns(rule({ maxRuns: 2 })), 2);
  });

  it("accounts for what has already been spent", () => {
    assert.equal(remainingRuns(rule({ maxRuns: 0, totalSpent: 30n })), 2);
  });

  it("is zero when the cap is consumed", () => {
    assert.equal(remainingRuns(rule({ maxRuns: 0, totalSpent: 50n })), 0);
  });
});

describe("createRuleParamsSchema", () => {
  const valid = {
    vault: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    amountPerRun: 10n,
    totalSpendCap: 50n,
    intervalSecs: 3600,
    maxRuns: 5,
    trigger: Trigger.TIME,
    startAt: 0n,
    thresholdPrice: 0n,
  };

  it("accepts a well formed rule", () => {
    assert.equal(createRuleParamsSchema.safeParse(valid).success, true);
  });

  it("rejects a cap below one run", () => {
    const r = createRuleParamsSchema.safeParse({ ...valid, totalSpendCap: 5n });
    assert.equal(r.success, false);
  });

  it("rejects a malformed vault address", () => {
    const r = createRuleParamsSchema.safeParse({ ...valid, vault: "not-an-address" });
    assert.equal(r.success, false);
  });

  it("rejects an interval below the minimum", () => {
    const r = createRuleParamsSchema.safeParse({ ...valid, intervalSecs: 30 });
    assert.equal(r.success, false);
  });

  it("rejects a price trigger with no threshold", () => {
    const r = createRuleParamsSchema.safeParse({
      ...valid,
      trigger: Trigger.PRICE_BELOW,
      thresholdPrice: 0n,
    });
    assert.equal(r.success, false);
  });

  it("accepts a price trigger with a threshold", () => {
    const r = createRuleParamsSchema.safeParse({
      ...valid,
      trigger: Trigger.PRICE_BELOW,
      thresholdPrice: 2_000_000n,
    });
    assert.equal(r.success, true);
  });

  it("rejects a zero amount", () => {
    const r = createRuleParamsSchema.safeParse({ ...valid, amountPerRun: 0n });
    assert.equal(r.success, false);
  });
});
