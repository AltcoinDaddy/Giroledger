/**
 * Minimal ABIs for Flare system contracts.
 *
 * Every signature here was transcribed from the official reference docs, not
 * inferred. Sources are cited per block. If you need a function that is not
 * here, read the doc page and add it. Do not guess.
 *
 *   https://dev.flare.network/smart-accounts/reference/IMasterAccountController
 *   https://dev.flare.network/smart-accounts/reference/IPersonalAccount
 *   https://dev.flare.network/network/guides/flare-contracts-registry
 */

/** Source: network/guides/flare-contracts-registry */
export const flareContractRegistryAbi = [
  {
    type: "function",
    name: "getContractAddressByName",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * IPayment.Proof, transcribed from fdc/reference/IPayment.
 *
 * This is the tuple `MasterAccountController.executeInstruction` expects, and
 * the shape the Data Availability layer returns as JSON. Field order matters:
 * ABI encoding is positional, so a reordered field silently produces a proof
 * that fails verification for no visible reason.
 */
export const paymentProofComponents = [
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
          { name: "inUtxo", type: "uint256" },
          { name: "utxo", type: "uint256" },
        ],
      },
      {
        name: "responseBody",
        type: "tuple",
        components: [
          { name: "blockNumber", type: "uint64" },
          { name: "blockTimestamp", type: "uint64" },
          { name: "sourceAddressHash", type: "bytes32" },
          { name: "sourceAddressesRoot", type: "bytes32" },
          { name: "receivingAddressHash", type: "bytes32" },
          { name: "intendedReceivingAddressHash", type: "bytes32" },
          { name: "spentAmount", type: "int256" },
          { name: "intendedSpentAmount", type: "int256" },
          { name: "receivedAmount", type: "int256" },
          { name: "intendedReceivedAmount", type: "int256" },
          { name: "standardPaymentReference", type: "bytes32" },
          { name: "oneToOne", type: "bool" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

/** Payment status codes. Source: fdc/reference/IPayment. */
export const PaymentStatus = {
  SUCCESS: 0,
  SENDER_FAILURE: 1,
  RECEIVER_FAILURE: 2,
} as const;

/** Source: fdc/getting-started. `requestAttestation` is payable, the fee is the value. */
export const fdcHubAbi = [
  {
    type: "function",
    name: "requestAttestation",
    stateMutability: "payable",
    inputs: [{ name: "_data", type: "bytes" }],
    outputs: [],
  },
] as const;

/**
 * Source: fdc/getting-started, "Wait for round finalization".
 * FDC protocol id is 200.
 */
export const relayAbi = [
  {
    type: "function",
    name: "isFinalized",
    stateMutability: "view",
    inputs: [
      { name: "_protocolId", type: "uint256" },
      { name: "_votingRoundId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const FDC_PROTOCOL_ID = 200n;

/**
 * Source: smart-accounts/reference/IMasterAccountController
 *
 * Uses the Diamond pattern, so all facets are behind one address. Resolve that
 * address from the registry under the name "MasterAccountController".
 */
export const masterAccountControllerAbi = [
  // --- personal accounts ---
  {
    type: "function",
    name: "getPersonalAccount",
    stateMutability: "view",
    inputs: [{ name: "_xrplOwner", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  // --- operator wallets: the addresses users send payments to ---
  {
    type: "function",
    name: "getXrplProviderWallets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string[]" }],
  },
  // --- vaults ---
  {
    type: "function",
    name: "getVaults",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_vaultIds", type: "uint256[]" },
      { name: "_vaultAddresses", type: "address[]" },
      { name: "_vaultTypes", type: "uint8[]" },
    ],
  },
  {
    type: "function",
    name: "getAgentVaults",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_agentVaultIds", type: "uint256[]" },
      { name: "_agentVaultAddresses", type: "address[]" },
    ],
  },
  // --- proof-based instruction execution ---
  {
    type: "function",
    name: "executeInstruction",
    stateMutability: "payable",
    inputs: [
      { name: "_proof", type: "tuple", components: paymentProofComponents },
      { name: "_xrplAddress", type: "string" },
    ],
    outputs: [],
  },
  // --- memo instruction nonce. Required for any 0xFE / 0xFF user operation. ---
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [{ name: "_personalAccount", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getExecutor",
    stateMutability: "view",
    inputs: [{ name: "_personalAccount", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  // --- fees and proofs ---
  {
    type: "function",
    name: "getDefaultInstructionFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getInstructionFee",
    stateMutability: "view",
    inputs: [{ name: "_instructionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isTransactionIdUsed",
    stateMutability: "view",
    inputs: [{ name: "_transactionId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getSourceId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getPaymentProofValidityDurationSeconds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getExecutorInfo",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_executor", type: "address" },
      { name: "_executorFee", type: "uint256" },
    ],
  },
  // --- events we care about ---
  {
    type: "event",
    name: "UserOperationExecuted",
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "InstructionExecuted",
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "transactionId", type: "bytes32", indexed: true },
      { name: "paymentReference", type: "bytes32", indexed: true },
      { name: "xrplOwner", type: "string", indexed: false },
      { name: "instructionId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DirectMintingExecuted",
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "transactionId", type: "bytes32", indexed: true },
      { name: "sourceAddress", type: "string", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executorFee", type: "uint256", indexed: false },
      { name: "executor", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "personalAccount", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  // --- errors worth decoding in logs ---
  { type: "error", name: "InvalidNonce", inputs: [
    { name: "expected", type: "uint256" },
    { name: "actual", type: "uint256" },
  ] },
  { type: "error", name: "InvalidSender", inputs: [
    { name: "sender", type: "address" },
    { name: "personalAccount", type: "address" },
  ] },
  { type: "error", name: "CustomInstructionHashMismatch", inputs: [
    { name: "expected", type: "bytes32" },
    { name: "actual", type: "bytes32" },
  ] },
  { type: "error", name: "CallFailed", inputs: [{ name: "returnData", type: "bytes" }] },
  { type: "error", name: "InvalidInstructionId", inputs: [{ name: "instructionId", type: "uint8" }] },
  { type: "error", name: "TransactionAlreadyExecuted", inputs: [] },
  { type: "error", name: "OnlyAssetManager", inputs: [] },
  { type: "error", name: "InvalidMemoData", inputs: [] },
] as const;

/**
 * Source: smart-accounts/reference/IPersonalAccount
 *
 * `xrplOwner()` is also the smart-account sniff test: if it returns a non-empty
 * XRPL address, the EVM address is a PersonalAccount.
 */
export const personalAccountAbi = [
  {
    type: "function",
    name: "xrplOwner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Vault types returned by `getVaults`. */
export const VaultType = {
  FIRELIGHT: 1,
  UPSHIFT: 2,
} as const;

export type VaultTypeValue = (typeof VaultType)[keyof typeof VaultType];

export const vaultTypeLabel: Record<number, string> = {
  1: "Firelight",
  2: "Upshift",
};
