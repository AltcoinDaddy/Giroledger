import type { Hex, PublicClient, WalletClient } from "viem";
import { fromXrplHex, masterAccountControllerAbi } from "@giroledger/shared";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import {
  contractByName,
  fetchProof,
  prepareXrpPaymentRequest,
  requestAttestation,
  submitInstruction,
  waitForFinalization,
  type FdcConfig,
} from "./fdc.js";

export interface PaymentContext {
  config: Config;
  publicClient: PublicClient;
  walletClient: WalletClient;
  log: Logger;
}

export interface IncomingPayment {
  /** xrpl's tx_json type varies across versions, so it is narrowed here. */
  tx: Record<string, unknown>;
  hash: string;
}

/**
 * One XRPL payment, end to end.
 *
 *   memo -> FDC attestation -> Merkle proof -> MasterAccountController
 *
 * Every step logs with `xrplTx` as the correlation id. When this breaks during
 * the demo, that field is how you find which stage failed.
 */
export async function handleIncomingPayment(
  payment: IncomingPayment,
  ctx: PaymentContext,
): Promise<void> {
  const { log, config, publicClient, walletClient } = ctx;

  const memo = extractMemo(payment.tx);
  if (!memo) {
    log.debug("payment carried no memo, ignoring");
    return;
  }

  const source = typeof payment.tx["Account"] === "string" ? payment.tx["Account"] : null;
  if (!source) {
    log.warn("payment has no Account field, cannot attribute it");
    return;
  }

  const txId = normaliseTxId(payment.hash);
  log.info({ memoBytes: (memo.length - 2) / 2, source }, "instruction memo received");

  // Cheap on-chain replay check. The contract enforces this too, but finding
  // out here saves an attestation request and about two minutes.
  const mac = await contractByName(publicClient, "MasterAccountController");
  const alreadyUsed = await publicClient.readContract({
    address: mac,
    abi: masterAccountControllerAbi,
    functionName: "isTransactionIdUsed",
    args: [txId],
  });
  if (alreadyUsed) {
    log.info("transaction already executed on Flare, skipping");
    return;
  }

  const fdc = fdcConfigFrom(config);

  const prepared = await prepareXrpPaymentRequest(txId, fdc);
  log.info("attestation request prepared");

  const { roundId } = await requestAttestation(
    prepared.abiEncodedRequest,
    { publicClient, walletClient },
    fdc,
    log,
  );

  // Rounds finalise in roughly 90 to 180 seconds. This is the latency the demo
  // has to be paced around.
  await waitForFinalization(roundId, publicClient, log);

  const proof = await fetchProof(roundId, prepared.abiEncodedRequest, fdc);
  log.info({ proofNodes: proof.merkleProof.length }, "proof retrieved");

  const txHash = await submitInstruction(proof, source, { publicClient, walletClient }, log);
  log.info({ txHash }, "done");
}

function fdcConfigFrom(config: Config): FdcConfig {
  return {
    verifierBaseUrl: config.FDC_VERIFIER_URL,
    verifierApiKey: config.FDC_VERIFIER_API_KEY,
    daLayerUrl: config.FDC_DA_LAYER_URL,
    daLayerApiKey: config.FDC_DA_LAYER_API_KEY,
    firstVotingRoundStartTs: config.FIRST_VOTING_ROUND_START_TS,
    votingEpochDurationSeconds: config.VOTING_EPOCH_DURATION_SECONDS,
  };
}

/** XRPL memos are uppercase hex in MemoData. Returns 0x-prefixed hex. */
export function extractMemo(tx: Record<string, unknown>): Hex | null {
  const memos = tx["Memos"];
  if (!Array.isArray(memos) || memos.length === 0) return null;

  const first = memos[0] as { Memo?: { MemoData?: string } } | undefined;
  const data = first?.Memo?.MemoData;
  if (typeof data !== "string" || data.length === 0) return null;

  return fromXrplHex(data);
}

/** XRPL transaction hashes are 64 hex chars, usually without a 0x prefix. */
export function normaliseTxId(hash: string): Hex {
  return (hash.startsWith("0x") ? hash : `0x${hash}`).toLowerCase() as Hex;
}
