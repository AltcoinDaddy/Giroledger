import { Client, Wallet } from "xrpl";
import {
  createPublicClient,
  createWalletClient,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";
import {
  assetManagerFxrpAbi,
  buildCreateRuleInstruction,
  coston2,
  computeDirectMintingPaymentUBA,
  explorerTx,
  flareContractRegistryAbi,
  FLARE_CONTRACT_REGISTRY,
  masterAccountControllerAbi,
  ruleRegistryAbi,
  sumActiveCommitment,
  ubaToXrp,
  XRPL_FDC_CONFIRMATIONS,
  XRP_PAYMENT_ATTESTATION,
  type ContractSet,
  type CreateRuleParams,
} from "@giroledger/shared";

/**
 * Create a GiroLedger rule from a single XRPL payment.
 *
 * Ported from Flare's `flare-viem-starter/src/custom-instructions.ts`, which is
 * the code that produced our first working execution. The only substantive
 * change is what the user operation calls: their demo pokes a Checkpoint, a
 * PiggyBank and a NoticeBoard; ours does `FXRP.approve` then
 * `RuleRegistry.createRule`.
 *
 * Three steps, two actors in production:
 *
 *   1. USER      encode the user operation, commit `keccak256` in a 42-byte
 *                `0xFE` memo, send ONE XRPL payment to the Core Vault address.
 *   2. EXECUTOR  fetch an FDC XRPPayment proof, call
 *                `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`.
 *   3. BOTH      MasterAccountController runs the user operation inside the
 *                executor's transaction, so `RuleCreated` is already in the
 *                receipt when it returns.
 *
 * On testnet we play both roles. Expect roughly 2m40s end to end, almost all of
 * it the FDC round.
 */

export interface CreateRuleContext {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  xrplClient: Client;
  xrplWallet: Wallet;
  contracts: ContractSet;
  verifier: { baseUrl: string; apiKey: string };
  log?: (msg: string) => void;
}

export interface CreateRuleResult {
  ruleId: Hex;
  personalAccount: Address;
  nonce: bigint;
  xrplTransactionHash: string;
  flareTransactionHash: Hex;
  elapsedMs: number;
}

const registryCache = new Map<string, Address>();

export async function contractByName(
  client: CreateRuleContext["publicClient"],
  name: string,
): Promise<Address> {
  const hit = registryCache.get(name);
  if (hit) return hit;
  const address = await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
  registryCache.set(name, address);
  return address;
}

/** Net mint plus minting fee plus executor fee, read live. */
export async function computePaymentXrp(
  client: CreateRuleContext["publicClient"],
  netMintXrp: number,
): Promise<number> {
  const assetManager = await contractByName(client, "AssetManagerFXRP");
  const read = (
    name:
      | "getDirectMintingExecutorFeeUBA"
      | "getDirectMintingFeeBIPS"
      | "getDirectMintingMinimumFeeUBA",
  ): Promise<bigint> =>
    client.readContract({
      address: assetManager,
      abi: assetManagerFxrpAbi,
      functionName: name,
    }) as Promise<bigint>;

  const [executorFeeUBA, feeBIPS, minimumFeeUBA] = await Promise.all([
    read("getDirectMintingExecutorFeeUBA"),
    read("getDirectMintingFeeBIPS"),
    read("getDirectMintingMinimumFeeUBA"),
  ]);

  const totalUBA = computeDirectMintingPaymentUBA({
    netMintUBA: BigInt(Math.round(netMintXrp * 1_000_000)),
    feeBIPS,
    minimumFeeUBA,
    executorFeeUBA,
  });
  return ubaToXrp(totalUBA);
}

export async function createRule(
  params: CreateRuleParams,
  ctx: CreateRuleContext,
  opts: { netMintXrp?: number } = {},
): Promise<CreateRuleResult> {
  const say = ctx.log ?? ((m: string) => console.log(m));
  const started = Date.now();
  const netMintXrp = opts.netMintXrp ?? 10;

  const mac = await contractByName(ctx.publicClient, "MasterAccountController");
  const assetManager = await contractByName(ctx.publicClient, "AssetManagerFXRP");

  const personalAccount = (await ctx.publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getPersonalAccount",
    args: [ctx.xrplWallet.address],
  })) as Address;

  // Read the nonce as late as possible. Two payments built from one nonce
  // collide; the loser reverts with InvalidNonce and its XRP is stranded at the
  // Core Vault. Never have two payments in flight for one account.
  const nonce = (await ctx.publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getNonce",
    args: [personalAccount],
  })) as bigint;

  // The FXRP allowance is shared by every rule on this account, and `approve`
  // sets it absolutely. Approving only this rule's cap would wipe out whatever
  // the account's existing active rules still need, and they would stop dead.
  const otherActiveCommitment = await readActiveCommitment(ctx, personalAccount);
  if (otherActiveCommitment > 0n) {
    say(`existing rules still need ${otherActiveCommitment} FXRP drops, preserving that`);
  }

  const instruction = buildCreateRuleInstruction({
    params,
    contracts: ctx.contracts,
    personalAccount,
    nonce,
    otherActiveCommitment,
  });

  say(`personal account ${personalAccount}`);
  say(`nonce            ${nonce}`);
  say(`userOpHash       ${instruction.userOpHash}`);
  say(`memo             ${instruction.memoData} (${(instruction.memoData.length - 2) / 2} bytes)`);

  // --- step 1: the user's single XRPL payment ------------------------------
  const coreVault = (await ctx.publicClient.readContract({
    address: assetManager,
    abi: assetManagerFxrpAbi,
    functionName: "directMintingPaymentAddress",
  })) as string;

  const amountXrp = await computePaymentXrp(ctx.publicClient, netMintXrp);

  // Check the balance INCLUDING the XRPL base reserve. A plain
  // `balance >= amount` check passes and the payment still bounces with
  // tecUNFUNDED_PAYMENT, because XRPL will not let an account spend below its
  // reserve. Learned this by burning an FDC round on a failed payment.
  const info = await ctx.xrplClient.request({
    command: "account_info",
    account: ctx.xrplWallet.address,
    ledger_index: "validated",
  });
  const balanceXrp = Number(info.result.account_data.Balance) / 1_000_000;
  const RESERVE_XRP = 1; // XRPL testnet base reserve
  const needed = amountXrp + RESERVE_XRP;
  if (balanceXrp < needed) {
    throw new Error(
      `XRPL wallet ${ctx.xrplWallet.address} has ${balanceXrp} XRP but needs ` +
        `${needed} (${amountXrp} payment + ${RESERVE_XRP} base reserve). ` +
        "Top it up at https://xrpl.org/xrp-testnet-faucet.html",
    );
  }

  say(`paying ${amountXrp} XRP to ${coreVault} (balance ${balanceXrp})`);

  const prepared = await ctx.xrplClient.autofill({
    TransactionType: "Payment",
    Account: ctx.xrplWallet.address,
    Destination: coreVault,
    Amount: String(Math.round(amountXrp * 1_000_000)),
    // NO DestinationTag. A tag makes FAssets credit the tag holder, which would
    // let someone front-run this operation.
    Memos: [{ Memo: { MemoData: instruction.memoData.slice(2).toUpperCase() } }],
  });
  const signed = ctx.xrplWallet.sign(prepared);
  const submitted = await ctx.xrplClient.submitAndWait(signed.tx_blob);
  const xrplTransactionHash = submitted.result.hash;

  // Check the XRPL result BEFORE spending two minutes on an attestation. A
  // failed payment still gets a hash and still attests fine, but the response
  // carries status 1 (SENDER_FAILURE) and receivedAmount 0, and the
  // AssetManager rightly refuses it. Failing here costs seconds; failing there
  // costs an FDC round and a confusing revert.
  const meta = submitted.result.meta;
  const result =
    typeof meta === "object" && meta !== null && "TransactionResult" in meta
      ? (meta as { TransactionResult: string }).TransactionResult
      : "unknown";

  if (result !== "tesSUCCESS") {
    throw new Error(
      `XRPL payment did not succeed: ${result} (tx ${xrplTransactionHash}).\n` +
        (result === "tecUNFUNDED_PAYMENT"
          ? "Insufficient XRP once the base reserve is accounted for. Top up the wallet."
          : "No FXRP was minted and nothing is stranded, the payment simply did not deliver."),
    );
  }

  say(`XRPL tx ${xrplTransactionHash} (${result})`);

  await waitForXrplFinality(ctx.xrplClient, xrplTransactionHash, say);

  // --- step 2: the executor's proof and submission --------------------------
  const proof = await fetchXrpPaymentProof({
    transactionId: normalizeTxId(xrplTransactionHash),
    proofOwner: ctx.walletClient.account!.address,
    ctx,
    say,
  });

  // Double the estimate. MasterAccountController catches each sub-call's
  // failure, so the estimator cannot see an inner call running out of gas, and
  // EIP-150 skims a sixty-fourth at every one of the four nesting levels. See
  // the long note in index.ts. Unused gas is refunded, so this costs nothing.
  const estimated = await ctx.publicClient.estimateContractGas({
    address: assetManager,
    abi: assetManagerFxrpAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof as never, instruction.data],
    value: instruction.totalCallValue,
    account: ctx.walletClient.account!,
  });
  const gas = estimated * 2n > 1_500_000n ? estimated * 2n : 1_500_000n;

  say(`submitting executeDirectMintingWithData (gas ${gas}, estimate ${estimated})`);
  const flareTransactionHash = await ctx.walletClient.writeContract({
    address: assetManager,
    abi: assetManagerFxrpAbi,
    functionName: "executeDirectMintingWithData",
    args: [proof as never, instruction.data],
    value: instruction.totalCallValue,
    chain: coston2,
    account: ctx.walletClient.account!,
    gas,
  });

  const receipt = await ctx.publicClient.waitForTransactionReceipt({
    hash: flareTransactionHash,
  });
  if (receipt.status === "reverted") {
    throw new Error(
      `executeDirectMintingWithData reverted: ${explorerTx(flareTransactionHash)}\n` +
        "No FXRP minted and no rule created, but the XRP stays at the Core Vault. " +
        "Recover with the 0xE0 skip-memo flow.",
    );
  }

  // --- step 3: read RuleCreated straight out of the receipt -----------------
  const created = parseEventLogs({
    abi: ruleRegistryAbi,
    eventName: "RuleCreated",
    logs: receipt.logs,
  });
  const first = created[0];
  if (!first) {
    throw new Error(
      `No RuleCreated in ${explorerTx(flareTransactionHash)}. ` +
        "If the transaction succeeded, check for DirectMintingDelayed: the mint may " +
        "have been rate limited, in which case retry executeDirectMintingWithData " +
        "with the SAME proof rather than sending another payment.",
    );
  }

  const ruleId = first.args.ruleId as Hex;
  const elapsedMs = Date.now() - started;
  say(`RuleCreated ${ruleId}`);
  say(`${explorerTx(flareTransactionHash)}`);
  say(`elapsed ${(elapsedMs / 1000).toFixed(0)}s`);

  return {
    ruleId,
    personalAccount,
    nonce,
    xrplTransactionHash,
    flareTransactionHash,
    elapsedMs,
  };
}

/* ------------------------------------------------------------------ helpers */

/**
 * What the account's active rules can still draw, read fresh from the registry.
 *
 * Read this immediately before building a memo, for the same reason the nonce
 * is read late: it is a snapshot that goes stale the moment anything executes.
 * A slightly stale value is safe in the create direction (it can only
 * over-approve by an amount some rule was already entitled to) and safe in the
 * cancel direction (it can only under-approve, which starves rather than
 * over-permits).
 */
export async function readActiveCommitment(
  ctx: CreateRuleContext,
  personalAccount: Address,
  exclude?: Hex,
): Promise<bigint> {
  const ids = await ctx.publicClient.readContract({
    address: ctx.contracts.ruleRegistry,
    abi: ruleRegistryAbi,
    functionName: "rulesOf",
    args: [personalAccount],
  });
  if (ids.length === 0) return 0n;

  const rules = await Promise.all(
    ids.map(async (ruleId) => {
      const r = await ctx.publicClient.readContract({
        address: ctx.contracts.ruleRegistry,
        abi: ruleRegistryAbi,
        functionName: "getRule",
        args: [ruleId],
      });
      return {
        ruleId,
        active: r.active,
        totalSpendCap: r.totalSpendCap,
        totalSpent: r.totalSpent,
      };
    }),
  );

  return sumActiveCommitment(rules, exclude);
}

export function normalizeTxId(hash: string): Hex {
  return (hash.startsWith("0x") ? hash : `0x${hash}`).toLowerCase() as Hex;
}

/**
 * Derive the FDC voting round from a block timestamp.
 *
 * Read the epoch parameters from `FlareSystemsManager`, never hardcode them.
 * The Coston values published in the FDC guide (1658429955 / 90s) are wrong for
 * Coston2 and produce a round id that is hundreds of rounds off. The failure is
 * silent: the attestation succeeds, and you simply poll a round that has no
 * proof for your request until you give up. Learned the hard way, 27 July.
 */
export async function computeRoundId(
  client: CreateRuleContext["publicClient"],
  blockTimestamp: bigint,
): Promise<number> {
  const fsm = await contractByName(client, "FlareSystemsManager");
  const abi = [
    {
      type: "function",
      name: "firstVotingRoundStartTs",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint64" }],
    },
    {
      type: "function",
      name: "votingEpochDurationSeconds",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "uint64" }],
    },
  ] as const;

  const [firstStart, duration] = await Promise.all([
    client.readContract({ address: fsm, abi, functionName: "firstVotingRoundStartTs" }),
    client.readContract({ address: fsm, abi, functionName: "votingEpochDurationSeconds" }),
  ]);

  return Number((blockTimestamp - firstStart) / duration);
}

/** FDC rejects a transaction that is not buried under enough validated ledgers. */
export async function waitForXrplFinality(
  client: Client,
  hash: string,
  say: (m: string) => void,
): Promise<void> {
  say(`waiting for ${XRPL_FDC_CONFIRMATIONS} XRPL confirmations`);
  const tx = await client.request({ command: "tx", transaction: hash });
  const txLedger = tx.result.ledger_index;
  if (txLedger === undefined) throw new Error("XRPL transaction has no ledger index");

  for (;;) {
    const ledger = await client.request({ command: "ledger", ledger_index: "validated" });
    const validated = ledger.result.ledger_index;
    if (validated - txLedger >= XRPL_FDC_CONFIRMATIONS) {
      say(`finality reached (tx ${txLedger}, validated ${validated})`);
      return;
    }
    await sleep(4_000);
  }
}

export async function fetchXrpPaymentProof(args: {
  transactionId: Hex;
  proofOwner: Address;
  ctx: CreateRuleContext;
  say: (m: string) => void;
}): Promise<unknown> {
  const { ctx, say } = args;
  const base = ctx.verifier.baseUrl.replace(/\/$/, "");

  const prepRes = await fetch(`${base}${XRP_PAYMENT_ATTESTATION.verifierPath}`, {
    method: "POST",
    headers: { "X-API-KEY": ctx.verifier.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationType: XRP_PAYMENT_ATTESTATION.type,
      sourceId: XRP_PAYMENT_ATTESTATION.sourceTestnet,
      requestBody: {
        transactionId: args.transactionId,
        // Binds the proof to the account that will submit it. The AssetManager
        // enforces this, so nobody else can replay it.
        proofOwner: args.proofOwner,
      },
    }),
  });
  if (!prepRes.ok) {
    throw new Error(`verifier prepareRequest failed: ${prepRes.status} ${await prepRes.text()}`);
  }
  const prep = (await prepRes.json()) as { status: string; abiEncodedRequest: Hex };
  if (prep.status !== "VALID") throw new Error(`verifier rejected request: ${prep.status}`);

  const fdcHub = await contractByName(ctx.publicClient, "FdcHub");
  const feeConfig = await contractByName(ctx.publicClient, "FdcRequestFeeConfigurations");
  const fee = (await ctx.publicClient.readContract({
    address: feeConfig,
    abi: [
      {
        type: "function",
        name: "getRequestFee",
        stateMutability: "view",
        inputs: [{ name: "_data", type: "bytes" }],
        outputs: [{ name: "", type: "uint256" }],
      },
    ] as const,
    functionName: "getRequestFee",
    args: [prep.abiEncodedRequest],
  })) as bigint;

  const hash = await ctx.walletClient.writeContract({
    address: fdcHub,
    abi: [
      {
        type: "function",
        name: "requestAttestation",
        stateMutability: "payable",
        inputs: [{ name: "_data", type: "bytes" }],
        outputs: [],
      },
    ] as const,
    functionName: "requestAttestation",
    args: [prep.abiEncodedRequest],
    value: fee,
    chain: coston2,
    account: ctx.walletClient.account!,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  const block = await ctx.publicClient.getBlock({ blockNumber: receipt.blockNumber });

  const roundId = await computeRoundId(ctx.publicClient, block.timestamp);
  say(`attestation requested, round ${roundId}`);

  // Poll the DA layer. The round has to finalise first, which is where the
  // ~2 minutes goes.
  const daBase = (process.env["FDC_DA_LAYER_URL"] ?? "").replace(/\/$/, "");
  if (!daBase) throw new Error("FDC_DA_LAYER_URL is not set");

  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5_000);
    const res = await fetch(`${daBase}/api/v0/fdc/get-proof-round-id-bytes`, {
      method: "POST",
      headers: {
        "X-API-KEY": process.env["FDC_DA_LAYER_API_KEY"] ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ votingRoundId: roundId, requestBytes: prep.abiEncodedRequest }),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { proof?: Hex[]; response?: unknown };
    if (body.proof && body.response) {
      say(`proof retrieved after ${(attempt + 1) * 5}s`);
      return { merkleProof: body.proof, data: body.response };
    }
  }
  throw new Error(`proof for round ${roundId} did not appear within 5 minutes`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
