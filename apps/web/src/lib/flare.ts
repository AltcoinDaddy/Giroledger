import { createPublicClient, http, type Address, type Hex } from "viem";
import {
  assetManagerFxrpAbi,
  computeDirectMintingPaymentUBA,
  coston2,
  FLARE_CONTRACT_REGISTRY,
  flareContractRegistryAbi,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  erc20Abi,
  ubaToXrp,
  type Rule,
  type TriggerValue,
} from "@giroledger/shared";

/**
 * `batch: true` matters more than it looks. This page fans out a dozen reads on
 * mount and the public Coston2 RPC rate limits aggressively; JSON-RPC batching
 * collapses them into a handful of HTTP requests.
 */
export const publicClient = createPublicClient({
  chain: coston2,
  transport: http(undefined, { batch: { wait: 16 } }),
});

/**
 * Hard cap the public RPC enforces on `eth_getLogs`. Ask for a wider span and
 * it rejects the whole request rather than truncating.
 */
export const MAX_LOG_SPAN = 30n;

const cache = new Map<string, Address>();

export async function contractByName(name: string): Promise<Address> {
  const hit = cache.get(name);
  if (hit) return hit;
  const address = await publicClient.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
  cache.set(name, address);
  return address;
}

/**
 * The whole point of the product in one function: an XRPL address maps to a
 * Flare account the user already controls, and the address is computable
 * before that account is ever deployed. No wallet connection anywhere.
 */
export async function resolvePersonalAccount(
  xrplAddress: string,
): Promise<{ account: Address; deployed: boolean; nonce: bigint }> {
  const mac = await contractByName("MasterAccountController");

  const account = await publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [xrplAddress],
  });

  const [code, nonce] = await Promise.all([
    publicClient.getCode({ address: account }),
    publicClient.readContract({
      address: mac,
      abi: masterAccountControllerAbi,
      functionName: "getNonce",
      args: [account],
    }),
  ]);

  return { account, deployed: code !== undefined && code !== "0x", nonce };
}

export async function getOperatorWallets(): Promise<readonly string[]> {
  const mac = await contractByName("MasterAccountController");
  return publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getXrplProviderWallets",
  });
}

export interface VaultInfo {
  id: bigint;
  address: Address;
  /**
   * Allowlisted in OUR registry. Flare listing it is not enough.
   *
   * `null` means the check itself failed, which is NOT the same as false. A
   * failed RPC read reported as "not allowed" is a lie that hides a working
   * vault behind a disabled option.
   */
  allowed: boolean | null;
  type: number;
}

/**
 * Flare's vaults, each marked with whether our registry will actually accept it.
 *
 * These are two different lists and conflating them is a trap. Flare's
 * MasterAccountController lists every vault on the network; `RuleRegistry`
 * only accepts vaults its owner has allowlisted. Offering a vault we have not
 * allowlisted produces a memo that looks perfect, costs a real XRPL payment,
 * and then reverts with `VaultNotAllowed` after the FDC round has finalised.
 */
export async function getVaults(): Promise<VaultInfo[]> {
  const mac = await contractByName("MasterAccountController");
  const [ids, addresses, types] = await publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getVaults",
  });

  const registry = import.meta.env["VITE_RULE_REGISTRY_ADDRESS"] as Address | undefined;

  /**
   * The vault our registry was deployed against, merged in even when Flare's
   * MasterAccountController does not list it.
   *
   * These two sources disagree in practice: `getVaults()` on Coston2 returned
   * four vaults during the spike and one later, and the Firelight vault our
   * registry allowlists was not in that one. Trusting Flare's list alone left
   * the page offering a single vault it could not use, with no way to pick the
   * one that works.
   */
  const configured = import.meta.env["VITE_VAULT_ADDRESS"] as Address | undefined;

  const merged: Array<{ id: bigint; address: Address; type: number }> = ids.map((id, i) => ({
    id,
    address: addresses[i] as Address,
    type: types[i] as number,
  }));

  if (
    configured &&
    !merged.some((v) => v.address.toLowerCase() === configured.toLowerCase())
  ) {
    merged.unshift({ id: 0n, address: configured, type: 0 });
  }

  const allowed = await Promise.all(
    merged.map(async ({ address }): Promise<boolean | null> => {
      if (!registry) return null;
      try {
        return await publicClient.readContract({
          address: registry,
          abi: ruleRegistryAbi,
          functionName: "vaultAllowed",
          args: [address as Address],
        });
      } catch (e) {
        // Deliberately null, not false. Returning false here would make a
        // throttled RPC read look identical to a genuine "not allowed", and
        // the UI would disable a perfectly good vault with a confident label.
        console.warn(`vaultAllowed(${address}) failed, treating as unknown`, e);
        return null;
      }
    }),
  );

  return merged.map((v, i) => ({ ...v, allowed: allowed[i] ?? null }));
}

export async function getFxrp(): Promise<{ address: Address; decimals: number; symbol: string }> {
  const assetManager = await contractByName("AssetManagerFXRP");
  const address = await publicClient.readContract({
    address: assetManager,
    abi: [
      {
        type: "function",
        name: "fAsset",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
      },
    ] as const,
    functionName: "fAsset",
  });
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { address, decimals, symbol };
}

export interface DirectMintingQuote {
  /** Where the XRPL payment must be sent. Read from the asset manager, never hardcoded. */
  destination: string;
  /** Exact amount in drops. Anything less and the mint reverts. */
  amountUBA: bigint;
  amountXrp: number;
  /** Component parts, shown so the number is not a mystery. */
  netMintUBA: bigint;
  mintingFeeUBA: bigint;
  executorFeeUBA: bigint;
}

/** Fee inputs, read once. Everything else is arithmetic. */
export interface MintingFees {
  destination: string;
  feeBIPS: bigint;
  minimumFeeUBA: bigint;
  executorFeeUBA: bigint;
}

/**
 * The live fee schedule for direct minting.
 *
 * Fetched once and then used to price any number of payments locally. A stale
 * fee means the payment is short, the mint reverts, and the XRP is stranded at
 * the Core Vault, so nothing here is hardcoded.
 */
export async function getMintingFees(): Promise<MintingFees> {
  const assetManager = await contractByName("AssetManagerFXRP");

  const [destination, executorFeeUBA, feeBIPS, minimumFeeUBA] = await Promise.all([
    publicClient.readContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "directMintingPaymentAddress",
    }),
    publicClient.readContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "getDirectMintingExecutorFeeUBA",
    }),
    publicClient.readContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "getDirectMintingFeeBIPS",
    }),
    publicClient.readContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: "getDirectMintingMinimumFeeUBA",
    }),
  ]);

  return { destination, feeBIPS, minimumFeeUBA, executorFeeUBA };
}

/**
 * Price one payment.
 *
 * `netMintUBA` is the FXRP the payment should buy, which is NOT always zero.
 *
 * Creating a rule has to leave the account holding enough FXRP for the rule to
 * spend, otherwise every execution fails at `transferFrom` and the rule is
 * quarantined. An earlier version priced creation at fees only, which produced
 * a rule that could never run for anyone who did not already hold FXRP.
 *
 * Cancelling genuinely mints nothing, so there the cost is fees alone.
 */
export function quoteFor(fees: MintingFees, netMintUBA: bigint): DirectMintingQuote {
  const amountUBA = computeDirectMintingPaymentUBA({
    netMintUBA,
    feeBIPS: fees.feeBIPS,
    minimumFeeUBA: fees.minimumFeeUBA,
    executorFeeUBA: fees.executorFeeUBA,
  });
  const proportional = (netMintUBA * fees.feeBIPS) / 10_000n;

  return {
    destination: fees.destination,
    amountUBA,
    amountXrp: ubaToXrp(amountUBA),
    netMintUBA,
    mintingFeeUBA: proportional > fees.minimumFeeUBA ? proportional : fees.minimumFeeUBA,
    executorFeeUBA: fees.executorFeeUBA,
  };
}

/**
 * Hand an instruction to the operator before the user pays for it.
 *
 * The `0xFE` memo is 42 bytes and carries only `keccak256(userOperation)`. An
 * operator watching the ledger sees "execute the thing whose hash is X" and has
 * no way to work out what X was, so the operation body has to be delivered
 * separately. Flare's docs call this "delivered off-chain to the executor".
 *
 * Handing it over grants nothing. The instruction is inert until a payment
 * signed by the owning XRPL account arrives carrying a memo that commits to
 * this exact hash, and the operator cannot alter it without breaking that hash.
 *
 * Returns false rather than throwing: a user can still pay if the operator is
 * down, and the payment stays recoverable afterwards. Blocking the whole
 * payment screen on a background service would be worse.
 */
export async function registerInstruction(instruction: {
  data: Hex;
  memoData: Hex;
  userOpHash: Hex;
  totalCallValue: bigint;
}): Promise<boolean> {
  const base = import.meta.env["VITE_OPERATOR_URL"] as string | undefined;
  if (!base) return false;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/instructions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: instruction.data,
        memoData: instruction.memoData,
        userOpHash: instruction.userOpHash,
        totalCallValue: instruction.totalCallValue.toString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getBalance(token: Address, holder: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
}

export interface Execution {
  ruleId: Hex;
  vault: Address;
  amount: bigint;
  shares: bigint;
  txHash: Hex;
  blockNumber: bigint;
}

const depositedEvent = {
  type: "event",
  name: "Deposited",
  inputs: [
    { name: "ruleId", type: "bytes32", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "vault", type: "address", indexed: true },
    { name: "amount", type: "uint128", indexed: false },
    { name: "shares", type: "uint256", indexed: false },
  ],
} as const;

export interface ExecutionHistory {
  executions: Execution[];
  /** How far back we actually managed to look. */
  fromBlock: bigint;
  toBlock: bigint;
  /** True if some windows failed, so the list may be incomplete. */
  partial: boolean;
}

/**
 * Execution history, read from `Deposited` events on the executor.
 *
 * The public Coston2 RPC caps `eth_getLogs` at a 30 block span and rejects
 * anything wider outright, so this walks backwards in 30 block windows rather
 * than asking for one wide range. Requests are JSON-RPC batched by the
 * transport, so the wall-clock cost is far below the request count.
 *
 * Never throws for a missing window. Partial history is useful; a page that
 * dies with a red RPC banner because one window timed out is not. The caller
 * gets `partial` so it can say so rather than quietly implying completeness.
 */
export async function getExecutions(
  executor: Address | undefined,
  account: Address,
  windows = 60,
): Promise<ExecutionHistory> {
  const head = await publicClient.getBlockNumber();
  const span = MAX_LOG_SPAN * BigInt(windows);
  const earliest = head > span ? head - span : 0n;

  if (!executor) {
    return { executions: [], fromBlock: earliest, toBlock: head, partial: false };
  }

  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let to = head; to > earliest; to -= MAX_LOG_SPAN) {
    const from = to - MAX_LOG_SPAN + 1n > earliest ? to - MAX_LOG_SPAN + 1n : earliest;
    ranges.push({ from, to });
  }

  let partial = false;
  const results = await Promise.all(
    ranges.map(async ({ from, to }) => {
      try {
        return await publicClient.getLogs({
          address: executor,
          event: depositedEvent,
          args: { account },
          fromBlock: from,
          toBlock: to,
        });
      } catch (e) {
        partial = true;
        console.warn(`getLogs ${from}-${to} failed`, e);
        return [];
      }
    }),
  );

  const executions = results
    .flat()
    .map((l) => ({
      ruleId: l.args.ruleId as Hex,
      vault: l.args.vault as Address,
      amount: l.args.amount as bigint,
      shares: l.args.shares as bigint,
      txHash: l.transactionHash,
      blockNumber: l.blockNumber,
    }))
    .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0));

  return { executions, fromBlock: earliest, toBlock: head, partial };
}

/** Reads rules from our own registry. Returns [] until the registry is deployed. */
export async function getRulesFor(
  registry: Address | undefined,
  account: Address,
): Promise<Rule[]> {
  if (!registry) return [];

  const ids = await publicClient.readContract({
    address: registry,
    abi: ruleRegistryAbi,
    functionName: "rulesOf",
    args: [account],
  });

  const rules = await Promise.all(
    ids.map(async (ruleId) => {
      const r = await publicClient.readContract({
        address: registry,
        abi: ruleRegistryAbi,
        functionName: "getRule",
        args: [ruleId],
      });
      return {
        ruleId: ruleId as Hex,
        account: r.account,
        vault: r.vault,
        amountPerRun: r.amountPerRun,
        totalSpendCap: r.totalSpendCap,
        totalSpent: r.totalSpent,
        nextRunAt: r.nextRunAt,
        intervalSecs: r.intervalSecs,
        maxRuns: r.maxRuns,
        runsDone: r.runsDone,
        thresholdPrice: r.thresholdPrice,
        trigger: r.trigger as TriggerValue,
        active: r.active,
      } satisfies Rule;
    }),
  );

  return rules;
}
