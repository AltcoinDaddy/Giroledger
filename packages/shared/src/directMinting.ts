/**
 * FAssets direct minting, the path a custom instruction rides on.
 *
 * All signatures transcribed from the reference docs and from Flare's
 * `flare-viem-starter`, which is the code that produced our first successful
 * execution on 27 July 2026.
 *
 *   https://dev.flare.network/fdc/reference/IXRPPayment
 *   https://dev.flare.network/smart-accounts/guides/typescript-viem/custom-instruction-ts
 */

/**
 * IXRPPayment.Proof.
 *
 * NOT the same as IPayment.Proof. This one is XRPL-specific: it carries the
 * `r`-address as a string, the first memo's raw bytes, and a destination tag,
 * and its RequestBody has a `proofOwner` rather than utxo indices. Using the
 * wrong struct produces a proof the AssetManager will not accept.
 *
 * Field order is load bearing. ABI encoding is positional.
 */
export const xrpPaymentProofComponents = [
  { name: "merkleProof", type: "bytes32[]" },
  {
    name: "data",
    type: "tuple",
    components: [
      { name: "attestationType", type: "bytes32" },
      { name: "sourceId", type: "bytes32" },
      { name: "votingRound", type: "uint64" },
      { name: "lowestUsedTimestamp", type: "uint64" },
      {
        name: "requestBody",
        type: "tuple",
        components: [
          { name: "transactionId", type: "bytes32" },
          { name: "proofOwner", type: "address" },
        ],
      },
      {
        name: "responseBody",
        type: "tuple",
        components: [
          { name: "blockNumber", type: "uint64" },
          { name: "blockTimestamp", type: "uint64" },
          { name: "sourceAddress", type: "string" },
          { name: "sourceAddressHash", type: "bytes32" },
          { name: "receivingAddressHash", type: "bytes32" },
          { name: "intendedReceivingAddressHash", type: "bytes32" },
          { name: "spentAmount", type: "int256" },
          { name: "intendedSpentAmount", type: "int256" },
          { name: "receivedAmount", type: "int256" },
          { name: "intendedReceivedAmount", type: "int256" },
          { name: "hasMemoData", type: "bool" },
          { name: "firstMemoData", type: "bytes" },
          { name: "hasDestinationTag", type: "bool" },
          { name: "destinationTag", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/** FDC attestation identifiers for this type. */
export const XRP_PAYMENT_ATTESTATION = {
  /** 32-byte right-padded ASCII "XRPPayment". */
  type: "0x5852505061796d656e7400000000000000000000000000000000000000000000",
  /** 32-byte right-padded ASCII "testXRP". */
  sourceTestnet: "0x7465737458525000000000000000000000000000000000000000000000000000",
  verifierPath: "/verifier/xrp/XRPPayment/prepareRequest",
} as const;

/**
 * AssetManagerFXRP, the slice we call.
 *
 * `executeDirectMintingWithData` is the executor-side entry point. `msg.value`
 * flows AssetManager -> MasterAccountController.handleMintedFAssets ->
 * PersonalAccount.executeUserOp, so it must equal the sum of call values in the
 * user operation.
 */
export const assetManagerFxrpAbi = [
  {
    type: "function",
    name: "executeDirectMintingWithData",
    stateMutability: "payable",
    inputs: [
      { name: "_payment", type: "tuple", components: xrpPaymentProofComponents },
      { name: "_data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "directMintingPaymentAddress",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "fAsset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // --- fee components, needed to compute the XRPL payment amount ---
  {
    type: "function",
    name: "getDirectMintingExecutorFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingFeeBIPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getDirectMintingMinimumFeeUBA",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** XRPL drops per XRP. FXRP shares this precision: 6 decimals. */
export const DROPS_PER_XRP = 1_000_000n;

/**
 * What the XRPL payment must carry: the net mint plus the minting fee plus the
 * executor fee. Mirrors `computeDirectMintingPaymentAmountXrp` in the starter.
 *
 * For a memo-only instruction the net mint can be 0, but the fees still apply.
 */
export function computeDirectMintingPaymentUBA(args: {
  netMintUBA: bigint;
  feeBIPS: bigint;
  minimumFeeUBA: bigint;
  executorFeeUBA: bigint;
}): bigint {
  const proportional = (args.netMintUBA * args.feeBIPS) / 10_000n;
  const mintingFee = proportional > args.minimumFeeUBA ? proportional : args.minimumFeeUBA;
  return args.netMintUBA + mintingFee + args.executorFeeUBA;
}

export const ubaToXrp = (uba: bigint): number => Number(uba) / Number(DROPS_PER_XRP);
export const xrpToUba = (xrp: number): bigint =>
  BigInt(Math.round(xrp * Number(DROPS_PER_XRP)));

/**
 * XRPL confirmations FDC requires before it will attest. Roughly 12 seconds.
 * Source: the custom-instruction guide.
 */
export const XRPL_FDC_CONFIRMATIONS = 3;
