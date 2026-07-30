/**
 * ABIs for contracts we control, plus the standard interfaces we call.
 *
 * These are transcribed from the deployed source in `contracts/src/`. When you
 * change a signature there, change it here in the same commit, or the keeper
 * and the frontend will silently disagree with the chain.
 *
 * IMPORTANT: nothing in this file is a Flare system contract ABI. Those live in
 * `flareAbi.ts`, are transcribed from the reference docs, and are resolved at
 * runtime through the FlareContractRegistry. See instruction.md §2 rule 2.
 */

/** Matches `RuleRegistry.Trigger`. Only TIME is enabled. See spec.md §11. */
export const ContractTrigger = {
  TIME: 0,
  PRICE_BELOW: 1,
  PRICE_ABOVE: 2,
} as const;

export const ruleRegistryAbi = [
  {
    type: "function",
    name: "createRule",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "vault", type: "address" },
          { name: "amountPerRun", type: "uint128" },
          { name: "totalSpendCap", type: "uint128" },
          { name: "intervalSecs", type: "uint32" },
          { name: "maxRuns", type: "uint16" },
          { name: "trigger", type: "uint8" },
          { name: "startAt", type: "uint64" },
          { name: "thresholdPrice", type: "int128" },
        ],
      },
    ],
    outputs: [{ name: "ruleId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelRule",
    stateMutability: "nonpayable",
    inputs: [{ name: "ruleId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "markExecuted",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ruleId", type: "bytes32" },
      { name: "amount", type: "uint128" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getRule",
    stateMutability: "view",
    inputs: [{ name: "ruleId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "account", type: "address" },
          { name: "vault", type: "address" },
          { name: "amountPerRun", type: "uint128" },
          { name: "totalSpendCap", type: "uint128" },
          { name: "totalSpent", type: "uint128" },
          { name: "nextRunAt", type: "uint64" },
          { name: "intervalSecs", type: "uint32" },
          { name: "maxRuns", type: "uint16" },
          { name: "runsDone", type: "uint16" },
          { name: "thresholdPrice", type: "int128" },
          { name: "trigger", type: "uint8" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isDue",
    stateMutability: "view",
    inputs: [{ name: "ruleId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "dueRules",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "ids", type: "bytes32[]" },
      { name: "nextOffset", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "rulesOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "totalRules",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "vaultAllowed",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setVaultAllowed",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "executor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  { type: "function", name: "MAX_PAGE", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "event",
    name: "RuleCreated",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: false },
      { name: "amountPerRun", type: "uint128", indexed: false },
      { name: "totalSpendCap", type: "uint128", indexed: false },
      { name: "trigger", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RuleExecuted",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
      { name: "at", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "RuleCancelled",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "RuleExhausted",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
    ],
  },
  { type: "error", name: "NotAccount", inputs: [] },
  { type: "error", name: "NotExecutor", inputs: [] },
  { type: "error", name: "RuleNotActive", inputs: [] },
  { type: "error", name: "RuleNotDue", inputs: [] },
  { type: "error", name: "CapExceeded", inputs: [] },
  { type: "error", name: "VaultNotAllowed", inputs: [] },
  { type: "error", name: "InvalidParams", inputs: [] },
  { type: "error", name: "TriggerNotEnabled", inputs: [] },
  { type: "error", name: "PageTooLarge", inputs: [] },
  { type: "error", name: "UnknownRule", inputs: [] },
] as const;

export const ruleExecutorAbi = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [{ name: "ruleId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "ruleIds", type: "bytes32[]" }],
    outputs: [{ name: "succeeded", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  { type: "function", name: "MAX_BATCH", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "REGISTRY", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "ASSET", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "vault", type: "address", indexed: true },
      { name: "amount", type: "uint128", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ExecutionSkipped",
    inputs: [
      { name: "ruleId", type: "bytes32", indexed: true },
      // Revert selector of the inner call. `0x00000000` means no revert data,
      // which in practice means the inner call ran out of gas.
      { name: "reason", type: "bytes4", indexed: false },
    ],
  },
  { type: "error", name: "IsPaused", inputs: [] },
  { type: "error", name: "NotSelf", inputs: [] },
  { type: "error", name: "BatchTooLarge", inputs: [] },
  { type: "error", name: "ResidualBalance", inputs: [] },
  {
    type: "error",
    name: "InsufficientGas",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "GAS_PER_RULE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "GAS_RESERVE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Minimal ERC-20. Only what we actually call. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** Minimal ERC-4626. `deposit` takes a receiver, which is how shares reach the user. */
export const erc4626Abi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "previewDeposit",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxDeposit",
    stateMutability: "view",
    inputs: [{ name: "receiver", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
