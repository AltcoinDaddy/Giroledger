import { useCallback, useEffect, useState } from "react";
import { ArrowSquareOut, CircleNotch, Warning, Wallet } from "@phosphor-icons/react";

/**
 * One button that sends the payment, memo intact.
 *
 * WHY THIS EXISTS. The memo is the instruction, and it is 84 hex characters of
 * raw bytes. No XRPL wallet tested here exposes a field that accepts it: GemWallet's
 * own send screen offers "Notes", which hex-encodes whatever text you type, so
 * pasting the memo produces 168 bytes of ASCII rather than the 42 bytes the
 * chain checks against. The payment would land, commit to nothing, and strand.
 *
 * The extension's API has no such problem. `sendPayment` takes
 * `memos: [{ memo: { memoData } }]` already hex encoded, which is exactly the
 * form this page produces, so the bytes pass through untouched.
 *
 * NO DESTINATION TAG, EVER. A tag makes FAssets credit the tag holder instead
 * of the payer. The field is deliberately absent below rather than set to zero.
 *
 * The copy buttons stay. This is an convenience for people who have the
 * extension, not a requirement: the whole point of the project is that any XRP
 * wallet can drive it.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "sending" }
  | { kind: "sent"; hash: string }
  | { kind: "rejected" }
  | { kind: "error"; message: string };

/** Coston2's FAssets bridge follows XRPL Testnet. Mainnet here would spend real XRP. */
const EXPECTED_NETWORK = "Testnet";

export function SendWithGemWallet(props: {
  /** XRPL address to pay. */
  destination: string;
  /** Amount in drops, as a string. Integer, never a decimal. */
  amountDrops: string;
  /** The 42-byte memo, hex, no 0x prefix, as the XRPL expects it. */
  memoHex: string;
  /** Shown under the button. Differs between creating and cancelling. */
  note?: string;
  /** False when the operator has not accepted the instruction. */
  disabled?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [network, setNetwork] = useState<string | null>(null);

  // Reset when the payment changes underneath us, so a stale "sent" hash never
  // sits under a memo it does not belong to.
  useEffect(() => {
    setPhase({ kind: "idle" });
  }, [props.memoHex, props.amountDrops]);

  const send = useCallback(() => {
    void (async () => {
      setPhase({ kind: "checking" });
      try {
        // Imported lazily. The package touches `window` on load, and this page
        // is server rendered.
        const { isInstalled, getNetwork, sendPayment } = await import("@gemwallet/api");

        const installed = await isInstalled();
        if (!installed.result.isInstalled) {
          setPhase({
            kind: "error",
            message:
              "GemWallet is not installed. Install the extension, or copy the three fields above into any XRPL wallet that can attach a hex memo.",
          });
          return;
        }

        const net = await getNetwork();
        const name = net.result?.network ?? null;
        setNetwork(name);
        if (name && name !== EXPECTED_NETWORK) {
          setPhase({
            kind: "error",
            message: `GemWallet is on ${name}. Switch it to ${EXPECTED_NETWORK}: this rule lives on Coston2, and a payment from mainnet would spend real XRP for nothing.`,
          });
          return;
        }

        setPhase({ kind: "sending" });
        const res = await sendPayment({
          amount: props.amountDrops,
          destination: props.destination,
          // Hex in, hex out. No re-encoding, which is the entire reason for
          // going through the API rather than the extension's own send screen.
          memos: [{ memo: { memoData: props.memoHex } }],
        });

        if (res.type === "reject" || !res.result?.hash) {
          setPhase({ kind: "rejected" });
          return;
        }
        setPhase({ kind: "sent", hash: res.result.hash });
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [props.amountDrops, props.destination, props.memoHex]);

  const busy = phase.kind === "checking" || phase.kind === "sending";

  if (phase.kind === "sent") {
    return (
      <div
        className="mt-4 rounded-[var(--radius)] border p-4"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <p className="text-[14px] font-semibold tracking-tight">Payment sent.</p>
        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          The operator now has two to three minutes of work: it waits for the payment to be
          proven to Flare, then submits that proof. Nothing else is needed from you.
        </p>
        <a
          href={`https://testnet.xrpl.org/transactions/${phase.hash}`}
          target="_blank"
          rel="noreferrer"
          className="tap mt-2 inline-flex items-center gap-1.5 font-mono text-[12px] underline decoration-1 underline-offset-4"
          style={{ color: "var(--text-muted)", textDecorationColor: "var(--border-strong)" }}
        >
          {phase.hash.slice(0, 16)}…{phase.hash.slice(-6)}
          <ArrowSquareOut size={11} />
        </a>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={send}
        disabled={busy || props.disabled === true}
        className="tap inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
      >
        {busy ? (
          <CircleNotch size={16} weight="bold" className="animate-spin" />
        ) : (
          <Wallet size={16} weight="bold" />
        )}
        {phase.kind === "checking"
          ? "Checking GemWallet…"
          : phase.kind === "sending"
            ? "Approve it in GemWallet…"
            : "Send with GemWallet"}
      </button>

      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
        {props.note ??
          "Opens the extension with the destination, amount and memo already filled in. Or copy the three fields above into any XRPL wallet that can attach a hex memo."}
        {network !== null && network !== EXPECTED_NETWORK ? ` GemWallet is on ${network}.` : ""}
      </p>

      {phase.kind === "rejected" && (
        <p className="mt-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          Rejected in the wallet. Nothing was sent, and the memo above is still valid.
        </p>
      )}

      {phase.kind === "error" && (
        <div
          className="mt-3 flex gap-2 rounded-[var(--radius)] border p-3"
          style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
        >
          <Warning size={15} weight="fill" className="mt-[2px] shrink-0" />
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {phase.message}
          </p>
        </div>
      )}
    </div>
  );
}
