import { useCallback, useEffect, useState } from "react";
import { Check, Copy, WarningCircle } from "@phosphor-icons/react";

/**
 * A labelled value with a copy button.
 *
 * Every field in the payment instruction is transcribe-or-fail: an XRPL
 * address mistyped by one character goes to a different account, and a memo
 * mistyped by one character produces a hash that commits to nothing. Copying
 * is the primary action, not a convenience.
 *
 * `navigator.clipboard` needs a secure context and can be blocked outright,
 * so failure is surfaced rather than swallowed. A copy button that silently
 * does nothing is worse than no button.
 */
export function Copyable(props: {
  label: string;
  value: string;
  hint?: string;
  /** Set on the one or two fields that must not be missed. */
  emphasis?: boolean;
  /** Off for human-readable values like an amount. */
  mono?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const mono = props.mono !== false;

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(props.value);
        setState("copied");
      } catch {
        setState("failed");
      }
    })();
  }, [props.value]);

  return (
    <div
      className="rounded-[var(--radius)] border p-3"
      style={{
        borderColor: props.emphasis === true ? "var(--accent-border)" : "var(--border)",
        background: props.emphasis === true ? "var(--accent-subtle)" : "var(--surface)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className="font-mono text-[10.5px] uppercase tracking-[0.14em]"
          style={{ color: "var(--text-faint)" }}
        >
          {props.label}
        </p>
        <button
          onClick={copy}
          aria-label={`Copy ${props.label}`}
          className="tap -mt-0.5 flex shrink-0 items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[11px] font-medium"
          style={{
            borderColor: state === "copied" ? "var(--ok)" : "var(--border-strong)",
            color: state === "copied" ? "var(--ok)" : "var(--text-muted)",
            background: "var(--surface)",
          }}
        >
          {state === "copied" ? (
            <>
              <Check size={12} weight="bold" /> Copied
            </>
          ) : state === "failed" ? (
            <>
              <WarningCircle size={12} weight="bold" /> Blocked
            </>
          ) : (
            <>
              <Copy size={12} /> Copy
            </>
          )}
        </button>
      </div>

      <p
        className={`mt-1.5 break-all ${mono ? "font-mono text-[13px] leading-snug" : "text-lg font-medium tnum"}`}
        style={{ color: "var(--text)" }}
      >
        {props.value}
      </p>

      {state === "failed" && (
        <p className="mt-1.5 text-[11px]" style={{ color: "var(--danger)" }}>
          The browser blocked clipboard access. Select the text and copy it manually.
        </p>
      )}

      {props.hint !== undefined && (
        <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
          {props.hint}
        </p>
      )}
    </div>
  );
}
