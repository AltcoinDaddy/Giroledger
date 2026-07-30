import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";

import {
  assertMemoWellFormed,
  encodeHashInstructionMemo,
  encodePackedUserOp,
  HASH_MEMO_BYTES,
  type Call,
} from "./smartAccount.js";

/**
 * GOLDEN TEST.
 *
 * These inputs and the expected hash come from a real Coston2 execution on
 * 27 July 2026 that emitted `UserOperationExecuted`:
 *
 *   Flare tx  0xeda8fab5dd91b353cafa63ffb8f8173f9dbbf55584b1d584e77bfe10b6a5ab89
 *   XRPL tx   075E4F92E1F2EE109DE828A16AB4A6A0B8EDEA483779B5C550CAF5C2A5F5BE75
 *
 * The chain accepted that user operation, so the hash below is known-correct.
 * If our encoder reproduces it, our encoding is byte-identical to the one Flare
 * accepted. If it ever stops matching, the encoding drifted and every rule we
 * build would fail with CustomInstructionHashMismatch.
 */
const LIVE = {
  sender: "0xe29c2E182bFB46977BA574f80005ac28C8720dab" as Address,
  nonce: 0n,
  expectedUserOpHash:
    "0x35ff0fa83c289d7ebdd87eeae30446d852cc3447fd2d266611484fcf86d04ebd" as Hex,
  expectedDataBytes: 1216,
  expectedTotalCallValue: 2_000_000_000_000_000_000n,
  calls: [
    {
      target: "0xEE6D54382aA623f4D16e856193f5f8384E487002" as Address,
      value: 0n,
      data: "0x80abd133" as Hex,
    },
    {
      target: "0x42Ccd4F0aB1C6Fa36BfA37C9e30c4DC4DD94dE42" as Address,
      value: 1_000_000_000_000_000_000n,
      data: "0xd0e30db0" as Hex,
    },
    {
      target: "0x59D57652BF4F6d97a6e555800b3920Bd775661Dc" as Address,
      value: 1_000_000_000_000_000_000n,
      data: "0x28d106b20000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c48656c6c6f20576f726c64210000000000000000000000000000000000000000" as Hex,
    },
  ] satisfies Call[],
};

describe("smart account encoding, against a real on-chain execution", () => {
  const result = encodeHashInstructionMemo({
    calls: LIVE.calls,
    sender: LIVE.sender,
    nonce: LIVE.nonce,
  });

  it("reproduces the exact userOpHash the chain accepted", () => {
    assert.equal(result.userOpHash, LIVE.expectedUserOpHash);
  });

  it("produces a PackedUserOperation of the same byte length", () => {
    assert.equal((result.data.length - 2) / 2, LIVE.expectedDataBytes);
  });

  it("sums call values correctly", () => {
    assert.equal(result.totalCallValue, LIVE.expectedTotalCallValue);
  });

  it("confirms why 0xFF was the wrong choice", () => {
    // 1216 bytes of user operation against a 1024-byte XRPL memo cap. The
    // inline 0xFF form could not have carried this.
    assert.ok(LIVE.expectedDataBytes > 1024);
  });
});

describe("memo layout", () => {
  const { memoData } = encodeHashInstructionMemo({
    calls: LIVE.calls,
    sender: LIVE.sender,
    nonce: LIVE.nonce,
  });

  it("is exactly 42 bytes", () => {
    assert.equal((memoData.length - 2) / 2, HASH_MEMO_BYTES);
  });

  it("starts with the 0xFE opcode", () => {
    assert.equal(memoData.slice(0, 4).toLowerCase(), "0xfe");
  });

  it("packs walletId then an 8 byte executor fee then the hash", () => {
    const body = memoData.slice(2);
    assert.equal(body.slice(0, 2).toLowerCase(), "fe");
    assert.equal(body.slice(2, 4), "00", "walletId 0");
    assert.equal(body.slice(4, 20), "0000000000000000", "executorFeeUBA 0, 8 bytes");
    assert.equal(`0x${body.slice(20)}`, LIVE.expectedUserOpHash);
  });

  it("stays 42 bytes no matter how many calls are batched", () => {
    const sizes = [1, 2, 5, 20].map((n) => {
      const calls: Call[] = Array.from({ length: n }, () => LIVE.calls[0]!);
      const m = encodeHashInstructionMemo({ calls, sender: LIVE.sender, nonce: 0n });
      return (m.memoData.length - 2) / 2;
    });
    assert.deepEqual(sizes, [42, 42, 42, 42]);
  });

  it("accepts a well formed memo", () => {
    assert.doesNotThrow(() => assertMemoWellFormed(memoData));
  });

  it("rejects a malformed one", () => {
    assert.throws(() => assertMemoWellFormed("0xdeadbeef"), /42 bytes/);
  });
});

describe("nonce and sender are load bearing", () => {
  const base = { calls: LIVE.calls, sender: LIVE.sender, nonce: LIVE.nonce };

  it("a different nonce produces a different hash", () => {
    const a = encodeHashInstructionMemo(base);
    const b = encodeHashInstructionMemo({ ...base, nonce: 1n });
    assert.notEqual(a.userOpHash, b.userOpHash);
  });

  it("a different sender produces a different hash", () => {
    const a = encodeHashInstructionMemo(base);
    const b = encodeHashInstructionMemo({
      ...base,
      sender: "0x0000000000000000000000000000000000000001" as Address,
    });
    assert.notEqual(a.userOpHash, b.userOpHash);
  });

  it("encodePackedUserOp is deterministic", () => {
    assert.equal(encodePackedUserOp(base), encodePackedUserOp(base));
  });
});
