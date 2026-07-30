import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  coston2,
  FLARE_CONTRACT_REGISTRY,
  flareContractRegistryAbi,
  fdcHubAbi,
  relayAbi,
  masterAccountControllerAbi,
  FDC_PROTOCOL_ID,
  PaymentStatus,
} from "@giroledger/shared";
import type { Logger } from "./logger.js";

/**
 * The FDC attestation pipeline, per dev.flare.network/fdc/getting-started:
 *
 *   1. prepareRequest  -> verifier service ABI-encodes the request
 *   2. requestAttestation -> FdcHub, on-chain, payable
 *   3. wait            -> Relay.isFinalized(protocolId 200, roundId)
 *   4. get-proof       -> Data Availability layer returns response + Merkle proof
 *   5. executeInstruction -> MasterAccountController, on-chain
 *
 * Rounds finalise in roughly 90 to 180 seconds. That latency is inherent to
 * rule creation and the demo has to be paced around it, not edited around it.
 */

/** 32-byte right-padded ASCII, the encoding FDC uses for type and source ids. */
export function toPaddedHex(text: string): Hex {
  let out = "";
  for (const ch of text) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return `0x${out.padEnd(64, "0")}` as Hex;
}

export const ATTESTATION_TYPE_PAYMENT = toPaddedHex("Payment");
export const SOURCE_TEST_XRP = toPaddedHex("testXRP");

export interface FdcConfig {
  /** e.g. https://fdc-verifiers-testnet.flare.network */
  verifierBaseUrl: string;
  verifierApiKey: string;
  daLayerUrl: string;
  daLayerApiKey: string;
  /**
   * Round timing. The FDC guide shows these read from FlareSystemsManager and
   * gives Coston values as an example.
   *
   * TODO(S-13 / Q5): confirm the Coston2 values, ideally by reading them from
   * FlareSystemsManager rather than configuring them. A wrong epoch length
   * silently computes the wrong roundId, and the failure looks like "the proof
   * never appears" rather than like a misconfiguration.
   */
  firstVotingRoundStartTs: number;
  votingEpochDurationSeconds: number;
}

export interface PreparedRequest {
  status: string;
  abiEncodedRequest: Hex;
}

export interface PaymentProof {
  merkleProof: readonly Hex[];
  data: unknown;
}

/* ------------------------------------------------------------------ step 1 */

/**
 * Ask the verifier to ABI-encode an XRPL Payment attestation request.
 *
 * TODO(S-13): the endpoint path is inferred from the EVMTransaction example
 * (`/verifier/eth/EVMTransaction/prepareRequest`). Confirm the XRPL path
 * against the verifier's Swagger at `${verifierBaseUrl}/verifier/api-doc`
 * before relying on it.
 */
export async function prepareXrpPaymentRequest(
  transactionId: Hex,
  cfg: FdcConfig,
): Promise<PreparedRequest> {
  const url = `${cfg.verifierBaseUrl.replace(/\/$/, "")}/verifier/xrp/Payment/prepareRequest`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": cfg.verifierApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      attestationType: ATTESTATION_TYPE_PAYMENT,
      sourceId: SOURCE_TEST_XRP,
      requestBody: {
        transactionId,
        // XRPL is account based, so both are always 0. Source: fdc/reference/IPayment.
        inUtxo: "0",
        utxo: "0",
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`verifier prepareRequest failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as PreparedRequest;
  if (body.status !== "VALID") {
    throw new Error(`verifier rejected the request: ${body.status}`);
  }
  return body;
}

/* ------------------------------------------------------------------ step 2 */

export async function requestAttestation(
  abiEncodedRequest: Hex,
  clients: { publicClient: PublicClient; walletClient: WalletClient },
  cfg: FdcConfig,
  log: Logger,
): Promise<{ roundId: number; txHash: Hex }> {
  const fdcHub = await contractByName(clients.publicClient, "FdcHub");

  // The fee is dynamic. Reading it is better than hardcoding a value that is
  // either wasteful or too small.
  const fee = await readRequestFee(clients.publicClient, abiEncodedRequest);

  const account = clients.walletClient.account;
  if (!account) throw new Error("wallet client has no account");

  const txHash = await clients.walletClient.writeContract({
    address: fdcHub,
    abi: fdcHubAbi,
    functionName: "requestAttestation",
    args: [abiEncodedRequest],
    value: fee,
    chain: coston2,
    account,
  });

  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  const block = await clients.publicClient.getBlock({ blockNumber: receipt.blockNumber });

  const roundId = Math.floor(
    (Number(block.timestamp) - cfg.firstVotingRoundStartTs) / cfg.votingEpochDurationSeconds,
  );

  log.info({ txHash, roundId, fee: fee.toString() }, "attestation requested");
  return { roundId, txHash };
}

async function readRequestFee(client: PublicClient, request: Hex): Promise<bigint> {
  const cfgContract = await contractByName(client, "FdcRequestFeeConfigurations");
  return client.readContract({
    address: cfgContract,
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
    args: [request],
  });
}

/* ------------------------------------------------------------------ step 3 */

export async function waitForFinalization(
  roundId: number,
  client: PublicClient,
  log: Logger,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 10_000;
  const relay = await contractByName(client, "Relay");
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const finalized = await client.readContract({
      address: relay,
      abi: relayAbi,
      functionName: "isFinalized",
      args: [FDC_PROTOCOL_ID, BigInt(roundId)],
    });
    if (finalized) {
      log.info({ roundId }, "round finalized");
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`round ${roundId} did not finalize within ${timeoutMs}ms`);
    }
    await sleep(pollMs);
  }
}

/* ------------------------------------------------------------------ step 4 */

export async function fetchProof(
  roundId: number,
  abiEncodedRequest: Hex,
  cfg: FdcConfig,
): Promise<PaymentProof> {
  const url = `${cfg.daLayerUrl.replace(/\/$/, "")}/api/v0/fdc/get-proof-round-id-bytes`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": cfg.daLayerApiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ votingRoundId: roundId, requestBytes: abiEncodedRequest }),
  });

  if (!res.ok) {
    throw new Error(`DA layer get-proof failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { proof?: Hex[]; response?: unknown };
  if (!body.proof || !body.response) {
    throw new Error("DA layer returned no proof, the round may not be finalized yet");
  }

  const status = (body.response as { responseBody?: { status?: string | number } }).responseBody
    ?.status;
  if (status !== undefined && Number(status) !== PaymentStatus.SUCCESS) {
    throw new Error(`attested payment was not successful (status ${String(status)})`);
  }

  return { merkleProof: body.proof, data: body.response };
}

/* ------------------------------------------------------------------ step 5 */

export async function submitInstruction(
  proof: PaymentProof,
  xrplAddress: string,
  clients: { publicClient: PublicClient; walletClient: WalletClient },
  log: Logger,
): Promise<Hex> {
  const mac = await contractByName(clients.publicClient, "MasterAccountController");
  const account = clients.walletClient.account;
  if (!account) throw new Error("wallet client has no account");

  const fee = await clients.publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "getDefaultInstructionFee",
  });

  const txHash = await clients.walletClient.writeContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "executeInstruction",
    // viem maps the JSON object onto the tuple by field name, which is why the
    // component order in `paymentProofComponents` has to match IPayment exactly.
    args: [proof as never, xrplAddress],
    value: fee,
    chain: coston2,
    account,
  });

  await clients.publicClient.waitForTransactionReceipt({ hash: txHash });
  log.info({ txHash, xrplAddress }, "instruction executed on Flare");
  return txHash;
}

/* ------------------------------------------------------------------- utils */

const registryCache = new Map<string, Address>();

export async function contractByName(client: PublicClient, name: string): Promise<Address> {
  const hit = registryCache.get(name);
  if (hit) return hit;
  const address = await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: flareContractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
  });
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new Error(`FlareContractRegistry has no entry named "${name}"`);
  }
  registryCache.set(name, address);
  return address;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
