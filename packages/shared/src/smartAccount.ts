import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

/**
 * Flare Smart Accounts custom-instruction encoding.
 *
 * Transcribed from Flare's own `flare-viem-starter` (src/utils/smart-accounts.ts)
 * and verified byte-for-byte against a live Coston2 execution on 27 July 2026.
 * See `smartAccount.test.ts`: it reproduces the exact `userOpHash` from the
 * transaction that first proved this works, which means any drift in this file
 * breaks a test rather than a demo.
 *
 * Reference: https://dev.flare.network/smart-accounts/guides/typescript-viem/custom-instruction-ts
 */

/** One call inside a user operation. Source: IPersonalAccount.Call. */
export interface Call {
  target: Address;
  value: bigint;
  data: Hex;
}

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

/**
 * EIP-4337 PackedUserOperation.
 *
 * Only `sender`, `nonce` and `callData` are validated on-chain. The rest are
 * present because the struct requires them, and are deliberately zeroed.
 */
const PACKED_USER_OPERATION_TUPLE = {
  type: "tuple",
  components: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "signature", type: "bytes" },
  ],
} as const;

/** Source: IPersonalAccount, coston2 periphery artifacts. */
export const executeUserOpAbi = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "payable",
    inputs: [
      {
        name: "_calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** ABI-encode the PackedUserOperation the executor delivers as `_data`. */
export function encodePackedUserOp(args: {
  calls: readonly Call[];
  sender: Address;
  nonce: bigint;
}): Hex {
  const callData = encodeFunctionData({
    abi: executeUserOpAbi,
    functionName: "executeUserOp",
    args: [args.calls as readonly { target: Address; value: bigint; data: Hex }[]],
  });

  return encodeAbiParameters(
    [PACKED_USER_OPERATION_TUPLE],
    [
      {
        sender: args.sender,
        nonce: args.nonce,
        initCode: "0x",
        callData,
        accountGasLimits: ZERO_BYTES32,
        preVerificationGas: 0n,
        gasFees: ZERO_BYTES32,
        paymasterAndData: "0x",
        signature: "0x",
      },
    ],
  );
}

export interface HashInstructionMemo {
  /** 42 bytes. Goes in the XRPL memo. */
  memoData: Hex;
  /** Full user operation. Delivered off-chain to the executor, never on XRPL. */
  data: Hex;
  /** keccak256(data). What the memo commits to. */
  userOpHash: Hex;
  /** Sum of call.value. The executor must forward this as msg.value. */
  totalCallValue: bigint;
}

/**
 * Build a `0xFE` custom-instruction memo.
 *
 * Layout, fixed at 42 bytes regardless of how many calls are batched:
 *
 *     0xFE | walletId (1B) | executorFeeUBA (8B big-endian) | keccak256(userOp) (32B)
 *
 * Size independence is the whole point. The `0xFF` inline variant carries the
 * entire user operation in the memo and blows the 1024-byte XRPL cap quickly:
 * the three-call demo encodes to 1216 bytes. Two calls would fit today, but the
 * limit is a cliff and this form never approaches it.
 */
export function encodeHashInstructionMemo(args: {
  calls: readonly Call[];
  sender: Address;
  nonce: bigint;
  /** Assigned by the Flare Foundation to wallet providers. 0 otherwise. */
  walletId?: number;
  /** Fee paid to the executor, in FXRP drops. 0 when self-executing. */
  executorFeeUBA?: bigint;
}): HashInstructionMemo {
  const data = encodePackedUserOp({
    calls: args.calls,
    sender: args.sender,
    nonce: args.nonce,
  });
  const userOpHash = keccak256(data);

  const memoData = concatHex([
    "0xFE",
    toHex(args.walletId ?? 0, { size: 1 }),
    toHex(args.executorFeeUBA ?? 0n, { size: 8 }),
    userOpHash,
  ]);

  const totalCallValue = args.calls.reduce((acc, c) => acc + c.value, 0n);

  return { memoData, data, userOpHash, totalCallValue };
}

/** The memo is always 42 bytes. Anything else means the layout drifted. */
export const HASH_MEMO_BYTES = 42;

export function assertMemoWellFormed(memoData: Hex): void {
  const bytes = (memoData.length - 2) / 2;
  if (bytes !== HASH_MEMO_BYTES) {
    throw new Error(`memo must be ${HASH_MEMO_BYTES} bytes, got ${bytes}`);
  }
  if (!memoData.toLowerCase().startsWith("0xfe")) {
    throw new Error(`memo must start with the 0xFE opcode, got ${memoData.slice(0, 4)}`);
  }
}
