import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, type Address, type Hex } from "viem";

import {
  buildCancelRuleCalls,
  buildCancelRuleInstruction,
  buildCreateRuleCalls,
  buildCreateRuleInstruction,
  buildXrplMemo,
  fromXrplHex,
  MemoOpcode,
  payloadFitsInline,
  sumActiveCommitment,
  toXrplHex,
  XRPL_MEMO_CAP_BYTES,
} from "./memo.js";
import { erc20Abi, ruleRegistryAbi } from "./abi.js";
import { Trigger, type CreateRuleParams } from "./types.js";

const CONTRACTS = {
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7" as Address, // real Coston2 FXRP
  ruleRegistry: "0x2222222222222222222222222222222222222222" as Address,
  ruleExecutor: "0x3333333333333333333333333333333333333333" as Address,
};

const PERSONAL_ACCOUNT = "0xe29c2E182bFB46977BA574f80005ac28C8720dab" as Address;

const params: CreateRuleParams = {
  vault: "0xF97B2bBdB2f4a561806e5038a503eCA81554634E" as Address, // real Firelight
  amountPerRun: 1_000_000n, // 1 FXRP, 6 decimals
  totalSpendCap: 5_000_000n,
  intervalSecs: 86_400,
  maxRuns: 5,
  trigger: Trigger.TIME,
  startAt: 0n,
  thresholdPrice: 0n,
};

describe("buildCreateRuleCalls", () => {
  const calls = buildCreateRuleCalls(params, CONTRACTS);

  it("emits approve then createRule, in that order", () => {
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.target, CONTRACTS.fxrp);
    assert.equal(calls[1]?.target, CONTRACTS.ruleRegistry);
  });

  /**
   * The README's security claim rests on this exact equality. If the approved
   * amount ever drifts above totalSpendCap, the on-chain ceiling stops being
   * the ceiling the user signed for.
   */
  it("approves EXACTLY totalSpendCap when this is the account's only rule", () => {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data });
    assert.equal(decoded.functionName, "approve");
    const [spender, amount] = decoded.args as readonly [Address, bigint];
    assert.equal(spender, CONTRACTS.ruleExecutor);
    assert.equal(amount, params.totalSpendCap);
  });

  /**
   * The regression. One ERC-20 allowance is shared by every rule on an account
   * and `approve` sets it absolutely, so approving just this rule's cap wipes
   * out whatever the account's existing rules still needed. Observed on
   * Coston2: a second rule left the first sitting DUE with runs remaining and
   * no allowance to draw them.
   */
  it("adds existing commitments so a new rule cannot starve the old ones", () => {
    const withOthers = buildCreateRuleCalls(params, CONTRACTS, 40n);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: withOthers[0]!.data });
    const [, amount] = decoded.args as readonly [Address, bigint];
    assert.equal(
      amount,
      params.totalSpendCap + 40n,
      "must cover this rule AND what other active rules still need",
    );
  });

  it("refuses a negative commitment rather than under-approving", () => {
    assert.throws(() => buildCreateRuleCalls(params, CONTRACTS, -1n));
  });

  it("approves the executor, never the vault", () => {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data });
    const [spender] = decoded.args as readonly [Address, bigint];
    assert.notEqual(spender, params.vault);
  });

  it("round trips every rule parameter through the calldata", () => {
    const decoded = decodeFunctionData({ abi: ruleRegistryAbi, data: calls[1]!.data });
    assert.equal(decoded.functionName, "createRule");
    const [p] = decoded.args as readonly [typeof params];

    assert.equal(p.vault, params.vault);
    assert.equal(p.amountPerRun, params.amountPerRun);
    assert.equal(p.totalSpendCap, params.totalSpendCap);
    assert.equal(p.intervalSecs, params.intervalSecs);
    assert.equal(p.maxRuns, params.maxRuns);
    assert.equal(p.trigger, params.trigger);
    assert.equal(p.startAt, params.startAt);
    assert.equal(p.thresholdPrice, params.thresholdPrice);
  });

  it("attaches no native value: our calls move FXRP, not C2FLR", () => {
    assert.deepEqual(
      calls.map((c) => c.value),
      [0n, 0n],
    );
  });
});

describe("buildCancelRuleCalls", () => {
  const ruleId = `0x${"ab".repeat(32)}` as Hex;
  const calls = buildCancelRuleCalls(ruleId, CONTRACTS);

  it("cancels first, then zeroes the allowance when it is the only rule", () => {
    assert.equal(calls.length, 2);

    const cancel = decodeFunctionData({ abi: ruleRegistryAbi, data: calls[0]!.data });
    assert.equal(cancel.functionName, "cancelRule");
    assert.deepEqual(cancel.args, [ruleId]);

    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[1]!.data });
    const [, amount] = approve.args as readonly [Address, bigint];
    assert.equal(amount, 0n, "sole rule: the allowance must be revoked outright");
  });

  /**
   * The other half of the regression. Zeroing a shared allowance to cancel one
   * rule stops every other rule on the account.
   */
  it("leaves other active rules their headroom instead of zeroing", () => {
    const withOthers = buildCancelRuleCalls(ruleId, CONTRACTS, 25n);
    const approve = decodeFunctionData({ abi: erc20Abi, data: withOthers[1]!.data });
    const [, amount] = approve.args as readonly [Address, bigint];
    assert.equal(amount, 25n, "other rules must keep exactly what they still need");
  });

  it("refuses a negative remainder", () => {
    assert.throws(() => buildCancelRuleCalls(ruleId, CONTRACTS, -1n));
  });
});

describe("sumActiveCommitment", () => {
  const r = (
    id: string,
    active: boolean,
    cap: bigint,
    spent: bigint,
  ): { ruleId: Hex; active: boolean; totalSpendCap: bigint; totalSpent: bigint } => ({
    ruleId: `0x${id.repeat(64).slice(0, 64)}` as Hex,
    active,
    totalSpendCap: cap,
    totalSpent: spent,
  });

  it("counts only what active rules can still draw", () => {
    const total = sumActiveCommitment([
      r("1", true, 100n, 40n), // 60 left
      r("2", false, 100n, 0n), // inactive, contributes nothing
      r("3", true, 50n, 50n), // fully spent
    ]);
    assert.equal(total, 60n);
  });

  it("excludes the rule being cancelled", () => {
    const target = r("1", true, 100n, 40n);
    const total = sumActiveCommitment([target, r("2", true, 30n, 10n)], target.ruleId);
    assert.equal(total, 20n, "only rule 2's remaining 20");
  });

  it("is zero when nothing is active", () => {
    assert.equal(sumActiveCommitment([r("1", false, 100n, 0n)]), 0n);
  });

  it("never goes negative if a read is inconsistent", () => {
    assert.equal(sumActiveCommitment([r("1", true, 10n, 999n)]), 0n);
  });
});

describe("buildCreateRuleInstruction", () => {
  const inst = buildCreateRuleInstruction({
    params,
    contracts: CONTRACTS,
    personalAccount: PERSONAL_ACCOUNT,
    nonce: 7n,
  });

  it("produces a 42 byte 0xFE memo", () => {
    assert.equal((inst.memoData.length - 2) / 2, 42);
    assert.equal(inst.memoData.slice(0, 4).toLowerCase(), "0xfe");
  });

  it("commits to the user operation it returns", () => {
    // memo tail is keccak256(data), so the executor cannot substitute bytes
    assert.ok(inst.memoData.toLowerCase().endsWith(inst.userOpHash.slice(2).toLowerCase()));
  });

  it("carries zero native value, so the executor forwards nothing", () => {
    assert.equal(inst.totalCallValue, 0n);
  });

  it("fits comfortably inside the XRPL memo cap", () => {
    assert.ok((inst.memoData.length - 2) / 2 < XRPL_MEMO_CAP_BYTES);
  });

  it("changes hash when the nonce changes", () => {
    const other = buildCreateRuleInstruction({
      params,
      contracts: CONTRACTS,
      personalAccount: PERSONAL_ACCOUNT,
      nonce: 8n,
    });
    assert.notEqual(inst.userOpHash, other.userOpHash);
  });

  it("changes hash when any rule parameter changes", () => {
    const other = buildCreateRuleInstruction({
      params: { ...params, amountPerRun: 2_000_000n },
      contracts: CONTRACTS,
      personalAccount: PERSONAL_ACCOUNT,
      nonce: 7n,
    });
    assert.notEqual(inst.userOpHash, other.userOpHash);
  });
});

describe("buildCancelRuleInstruction", () => {
  it("also produces a 42 byte memo", () => {
    const inst = buildCancelRuleInstruction({
      ruleId: `0x${"cd".repeat(32)}` as Hex,
      contracts: CONTRACTS,
      personalAccount: PERSONAL_ACCOUNT,
      nonce: 1n,
    });
    assert.equal((inst.memoData.length - 2) / 2, 42);
    assert.equal(inst.totalCallValue, 0n);
  });
});

describe("XRPL hex", () => {
  it("uppercases and strips 0x on the way out", () => {
    assert.equal(toXrplHex("0xdeadBEEF"), "DEADBEEF");
  });

  it("lowercases and adds 0x on the way back", () => {
    assert.equal(fromXrplHex("DEADBEEF"), "0xdeadbeef");
  });

  it("round trips", () => {
    const original = "0xa1b2c3d4e5f6";
    assert.equal(fromXrplHex(toXrplHex(original)), original);
  });

  it("wraps a payload in the XRPL memo envelope", () => {
    assert.equal(buildXrplMemo("0xcafe").Memo.MemoData, "CAFE");
  });

  it("wraps a real instruction memo", () => {
    const inst = buildCreateRuleInstruction({
      params,
      contracts: CONTRACTS,
      personalAccount: PERSONAL_ACCOUNT,
      nonce: 0n,
    });
    const memo = buildXrplMemo(inst.memoData);
    assert.equal(memo.Memo.MemoData.length, 84, "42 bytes as hex");
    assert.equal(memo.Memo.MemoData, memo.Memo.MemoData.toUpperCase());
  });
});

describe("payloadFitsInline", () => {
  it("accepts a small payload", () => {
    assert.equal(payloadFitsInline("0x1234"), true);
  });

  it("rejects one past the 1024 byte cap", () => {
    assert.equal(payloadFitsInline(`0x${"ff".repeat(1025)}` as Hex), false);
  });
});

describe("MemoOpcode", () => {
  it("matches the Flare Smart Accounts opcodes", () => {
    assert.equal(MemoOpcode.CUSTOM_INSTRUCTION_HASH, 0xfe);
    assert.equal(MemoOpcode.CUSTOM_INSTRUCTION_INLINE, 0xff);
  });
});
