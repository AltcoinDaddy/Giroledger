import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Info,
  Stop,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  buildCancelRuleInstruction,
  buildCreateRuleInstruction,
  sumActiveCommitment,
  explorerAddress,
  explorerTx,
  deriveStatus,
  toXrplHex,
  Trigger,
  type CreateRuleParams,
  type Rule,
} from "@giroledger/shared";

import {
  getBalance,
  getMintingFees,
  registerInstruction,
  quoteFor,
  getExecutions,
  getFxrp,
  getRulesFor,
  getVaults,
  resolvePersonalAccount,
  type MintingFees,
  type ExecutionHistory,
  type VaultInfo,
} from "../lib/flare";
import { Qr } from "../components/Qr";
import { Copyable } from "../components/Copyable";
import { SiteHeader } from "../components/SiteHeader";
import {
  duration,
  looksLikeXrplAddress,
  relativeTime,
  short,
  toUnits,
  units,
} from "../lib/format";

export const Route = createFileRoute("/app")({ component: App });

const REGISTRY = import.meta.env["VITE_RULE_REGISTRY_ADDRESS"] as Address | undefined;
const EXECUTOR = import.meta.env["VITE_RULE_EXECUTOR_ADDRESS"] as Address | undefined;

const INTERVALS = [
  // Labelled as a demo option rather than dressed up as a product feature. It
  // exists so three executions fit inside a ninety second recording.
  { label: "2 min", secs: 120, note: "demo" },
  { label: "Hourly", secs: 3600 },
  { label: "Daily", secs: 86400 },
  { label: "Weekly", secs: 604800 },
];

interface Resolved {
  account: Address;
  deployed: boolean;
  nonce: bigint;
}

function App() {
  const [xrpl, setXrpl] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [fxrp, setFxrp] = useState<{
    address: Address;
    decimals: number;
    symbol: string;
  } | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [history, setHistory] = useState<ExecutionHistory | null>(null);
  const [fees, setFees] = useState<MintingFees | null>(null);
  const [stopping, setStopping] = useState<Hex | null>(null);

  const [amount, setAmount] = useState("10");
  const [runs, setRuns] = useState("10");
  const [intervalSecs, setIntervalSecs] = useState(86400);
  const [vaultIdx, setVaultIdx] = useState(0);

  const valid = looksLikeXrplAddress(xrpl);
  const decimals = fxrp?.decimals ?? 6;
  const symbol = fxrp?.symbol ?? "FXRP";

  useEffect(() => {
    void (async () => {
      try {
        const [vs, token, f] = await Promise.all([
          getVaults(),
          getFxrp(),
          getMintingFees(),
        ]);
        setVaults(vs);
        setFxrp(token);
        setFees(f);
        // Never leave a non-allowlisted vault selected by default. Index 0 is
        // whichever vault Flare happens to list first, which is not ours.
        const firstAllowed = vs.findIndex((v) => v.allowed === true);
        if (firstAllowed >= 0) setVaultIdx(firstAllowed);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const resolve = useCallback(async () => {
    if (!valid) return;
    setResolving(true);
    setError(null);
    try {
      const r = await resolvePersonalAccount(xrpl.trim());
      setResolved(r);
      if (fxrp) setBalance(await getBalance(fxrp.address, r.account));
      // Rules are authoritative and cheap. History is best effort: it walks
      // dozens of 30 block windows and a failure there must not blank the page.
      setRules(await getRulesFor(REGISTRY, r.account));
      setHistory(await getExecutions(EXECUTOR, r.account));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResolved(null);
    } finally {
      setResolving(false);
    }
  }, [xrpl, valid, fxrp]);

  const params: CreateRuleParams | null = useMemo(() => {
    const vault = vaults[vaultIdx];
    if (!vault) return null;
    const perRun = toUnits(amount, decimals);
    if (perRun <= 0n) return null;
    const n = BigInt(Math.max(1, Number(runs) || 1));
    return {
      vault: vault.address,
      amountPerRun: perRun,
      totalSpendCap: perRun * n,
      intervalSecs,
      maxRuns: Number(n),
      trigger: Trigger.TIME,
      startAt: 0n,
      thresholdPrice: 0n,
    };
  }, [vaults, vaultIdx, amount, runs, intervalSecs, decimals]);

  /**
   * The real thing: the two calls, the packed user operation, and the 42-byte
   * `0xFE` memo that commits to its hash.
   *
   * Requires a resolved account, because the memo binds to that account's
   * current nonce. Build it from a stale nonce and the payment reverts with
   * `InvalidNonce` and the XRP is stranded at the Core Vault, so the nonce is
   * re-read on every resolve rather than cached.
   */
  const instruction = useMemo(() => {
    if (!params || !fxrp || !resolved || !REGISTRY || !EXECUTOR) return null;
    try {
      return buildCreateRuleInstruction({
        params,
        contracts: {
          fxrp: fxrp.address,
          ruleRegistry: REGISTRY,
          ruleExecutor: EXECUTOR,
        },
        personalAccount: resolved.account,
        nonce: resolved.nonce,
        // One ERC-20 allowance is shared by every rule on the account, and
        // `approve` sets it absolutely. Approving only this rule's cap would
        // wipe out the headroom the account's existing rules still need and
        // stop them dead. `rules` is read on resolve, alongside the nonce.
        otherActiveCommitment: sumActiveCommitment(rules),
      });
    } catch {
      return null;
    }
  }, [params, fxrp, resolved, rules]);

  /**
   * The rule must be able to fund itself.
   *
   * A rule whose account holds less FXRP than its cap fails at `transferFrom`
   * on the first run it cannot cover, gets skipped, and is quarantined after
   * three attempts. So the creating payment mints the shortfall between what
   * the account already holds and what the rule is allowed to spend. If the
   * balance already covers it the shortfall is zero and the payment is fees
   * only.
   */
  const createQuote = useMemo(() => {
    if (!fees || !params) return null;
    const held = balance ?? 0n;
    const shortfall = params.totalSpendCap > held ? params.totalSpendCap - held : 0n;
    return quoteFor(fees, shortfall);
  }, [fees, params, balance]);

  /** Cancelling mints nothing, so it costs the fees and nothing else. */
  const cancelQuote = useMemo(() => (fees ? quoteFor(fees, 0n) : null), [fees]);

  /**
   * The memo that stops a rule: cancelRule, then an approve that lowers the
   * shared allowance to what the account's OTHER active rules still need.
   * Approving zero here would stop every other rule on the account too.
   */
  const cancelInstruction = useMemo(() => {
    if (!stopping || !fxrp || !resolved || !REGISTRY || !EXECUTOR) return null;
    try {
      return buildCancelRuleInstruction({
        ruleId: stopping,
        contracts: { fxrp: fxrp.address, ruleRegistry: REGISTRY, ruleExecutor: EXECUTOR },
        personalAccount: resolved.account,
        nonce: resolved.nonce,
        remainingCommitment: sumActiveCommitment(rules, stopping),
      });
    } catch {
      return null;
    }
  }, [stopping, fxrp, resolved, rules]);

  /**
   * Hand the displayed instruction to the operator.
   *
   * The memo commits to a hash; the operator needs the operation itself, and it
   * has to have it before the payment lands. Registered whenever the displayed
   * instruction changes, so whatever is on screen is what the operator holds.
   *
   * `registered === false` is shown as a warning rather than a blocker: paying
   * without it strands the payment at the Core Vault until someone completes it
   * manually, which is recoverable but not something to discover afterwards.
   */
  const [registered, setRegistered] = useState<boolean | null>(null);
  const active = stopping ? cancelInstruction : instruction;

  useEffect(() => {
    if (!active) {
      setRegistered(null);
      return;
    }
    let live = true;
    setRegistered(null);
    void registerInstruction({
      data: active.data,
      memoData: active.memoData,
      userOpHash: active.userOpHash,
      totalCallValue: active.totalCallValue,
    }).then((ok) => {
      if (live) setRegistered(ok);
    });
    return () => {
      live = false;
    };
  }, [active]);

  const vaultsLoaded = vaults.length > 0;
  const noneAllowed = vaultsLoaded && vaults.every((v) => v.allowed === false);
  const someUnverified = vaults.some((v) => v.allowed === null);

  return (
    <div className="landing min-h-[100dvh] relative overflow-hidden" style={{ background: "var(--bg)" }}>
      <div className="hero-wash" />
      <div className="absolute inset-0 z-0 opacity-[0.04] dark:opacity-[0.03]" 
           style={{ 
             backgroundImage: 'linear-gradient(var(--l-text) 1px, transparent 1px), linear-gradient(90deg, var(--l-text) 1px, transparent 1px)', 
             backgroundSize: '4rem 4rem',
             maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)'
           }} 
      />
      <SiteHeader active="app" />

      <main className="relative z-10 mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
        <Intro />

        {error && (
          <Callout tone="danger" icon={<Warning size={15} weight="fill" />}>
            <span className="font-mono text-[12px] leading-relaxed break-all">{error}</span>
          </Callout>
        )}

        {/* ---------------------------------------------------- step 1 --- */}
        <Step n="1" title="Your XRP address">
          <p className="max-w-[62ch] text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Paste any XRP Ledger address. Nothing is signed, nothing is connected, and the
            address does not need to exist on Flare yet. Its account there is derived
            deterministically.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <input
              value={xrpl}
              onChange={(e) => setXrpl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void resolve();
              }}
              placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              spellCheck={false}
              aria-label="XRP Ledger address"
              className="min-w-0 flex-1 rounded-[var(--radius)] border px-3 py-2.5 font-mono text-sm outline-none sm:min-w-[22rem]"
              style={{
                borderColor: xrpl.length > 0 && !valid ? "var(--danger)" : "var(--border-strong)",
                background: "var(--surface)",
                color: "var(--text)",
              }}
            />
            <button
              onClick={() => void resolve()}
              disabled={!valid || resolving}
              className="tap flex items-center gap-2 rounded-[var(--radius)] px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed"
              style={{
                background: !valid || resolving ? "var(--bg-subtle)" : "var(--accent)",
                color: !valid || resolving ? "var(--text-faint)" : "var(--accent-fg)",
              }}
            >
              {resolving && <ArrowsClockwise size={14} weight="bold" className="animate-spin" />}
              {resolving ? "Resolving" : "Resolve"}
            </button>
          </div>

          {xrpl.length > 0 && !valid && (
            <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>
              That does not look like an XRPL classic address. They start with{" "}
              <code>r</code> and are 25 to 35 characters.
            </p>
          )}

          {resolved && (
            <dl className="fade-in mt-5 grid gap-px overflow-hidden rounded-[var(--radius)] border sm:grid-cols-3"
                style={{ borderColor: "var(--border)", background: "var(--border)" }}>
              <Cell label="Flare account">
                <a
                  href={explorerAddress(resolved.account)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline decoration-1 underline-offset-4"
                  style={{ textDecorationColor: "var(--border-strong)" }}
                >
                  {short(resolved.account, 10, 8)}
                  <ArrowSquareOut size={12} />
                </a>
              </Cell>
              <Cell label="Status">
                <StatusDot ok={resolved.deployed} />
                {resolved.deployed ? "Deployed" : "Not deployed yet"}
              </Cell>
              <Cell label={`${symbol} balance`}>
                <span className="tnum">
                  {balance === null ? "Reading…" : `${units(balance, decimals)} ${symbol}`}
                </span>
              </Cell>
            </dl>
          )}
        </Step>

        {/* ---------------------------------------------------- step 2 --- */}
        <Step n="2" title="Standing order">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={`Amount per run (${symbol})`}>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-[var(--radius)] border px-3 py-2.5 text-sm tnum outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--surface)",
                  color: "var(--text)",
                }}
              />
            </Field>

            <Field label="Number of runs">
              <input
                value={runs}
                onChange={(e) => setRuns(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-[var(--radius)] border px-3 py-2.5 text-sm tnum outline-none"
                style={{
                  borderColor: "var(--border-strong)",
                  background: "var(--surface)",
                  color: "var(--text)",
                }}
              />
            </Field>

            <Field label="Frequency">
              <div
                className="grid grid-cols-4 gap-px overflow-hidden rounded-[var(--radius)] border"
                style={{ borderColor: "var(--border-strong)", background: "var(--border)" }}
              >
                {INTERVALS.map((i) => {
                  const on = intervalSecs === i.secs;
                  return (
                    <button
                      key={i.secs}
                      onClick={() => setIntervalSecs(i.secs)}
                      aria-pressed={on}
                      className="tap px-2 py-2.5 text-[13px] font-medium"
                      style={{
                        background: on ? "var(--accent)" : "var(--surface)",
                        color: on ? "var(--accent-fg)" : "var(--text-muted)",
                      }}
                    >
                      {i.label}
                      {i.note !== undefined && (
                        <span className="block text-[9.5px] font-normal opacity-70">{i.note}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Destination vault">
              {!vaultsLoaded ? (
                <div
                  className="h-[42px] w-full animate-pulse rounded-[var(--radius)] border"
                  style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}
                />
              ) : (
                <select
                  value={vaultIdx}
                  onChange={(e) => setVaultIdx(Number(e.target.value))}
                  className="w-full rounded-[var(--radius)] border px-3 py-2.5 font-mono text-[13px] outline-none"
                  style={{
                    borderColor: "var(--border-strong)",
                    background: "var(--surface)",
                    color: "var(--text)",
                  }}
                >
                  {vaults.map((v, i) => (
                    <option key={v.address} value={i} disabled={v.allowed === false}>
                      {v.type === 1 ? "Firelight" : v.type === 2 ? "Upshift" : "Vault"} #
                      {v.id.toString()} · {short(v.address)}
                      {v.allowed === false
                        ? " · not allowlisted"
                        : v.allowed === null
                          ? " · unverified"
                          : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          {noneAllowed && (
            <Callout tone="danger" icon={<Warning size={15} weight="fill" />}>
              None of these vaults are allowlisted in this registry, so every rule would revert
              with <code>VaultNotAllowed</code>. Run <code>setVaultAllowed</code> as the registry
              owner.
            </Callout>
          )}
          {someUnverified && (
            <Callout tone="accent" icon={<Info size={15} weight="fill" />}>
              Some allowlist checks did not complete, so those vaults are marked unverified
              rather than blocked. Reload to retry.
            </Callout>
          )}

          {params && (
            <p
              className="mt-5 border-l-2 pl-4 text-[15px] leading-relaxed"
              style={{ borderColor: "var(--accent)", color: "var(--text-muted)" }}
            >
              Move <Num>{units(params.amountPerRun, decimals)}</Num> {symbol} every{" "}
              <Num>{duration(intervalSecs)}</Num>, <Num>{params.maxRuns}</Num> times. The most
              this rule can ever spend is{" "}
              <Num>{units(params.totalSpendCap, decimals)}</Num> {symbol}.{" "}
              <span style={{ color: "var(--text)" }}>
                That ceiling is enforced on-chain, not by this page.
              </span>
            </p>
          )}
        </Step>

        {/* ---------------------------------------------------- step 3 --- */}
        <Step n="3" title="The payment to send">
          {!REGISTRY || !EXECUTOR ? (
            <Callout tone="danger" icon={<Warning size={15} weight="fill" />}>
              Contracts are not configured. Set <code>VITE_RULE_REGISTRY_ADDRESS</code> and{" "}
              <code>VITE_RULE_EXECUTOR_ADDRESS</code> in the root <code>.env</code>.
            </Callout>
          ) : !resolved ? (
            <Empty>
              Resolve an address first. The memo commits to that account&rsquo;s current nonce,
              so it cannot be built without one.
            </Empty>
          ) : !createQuote || !instruction ? (
            <Empty>Reading live fees from the asset manager&hellip;</Empty>
          ) : (
            <div className="fade-in">
              <p
                className="max-w-[62ch] text-sm leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                Send this one payment from your XRP wallet. Both fields are mandatory. The memo
                is what authorises the rule, so a payment without it is just a payment.{" "}
                <Link to="/faq" className="font-medium underline hover:opacity-80 transition-opacity" style={{ color: "var(--accent)" }}>
                  Why does this matter?
                </Link>
              </p>

              <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-start">
                <div className="shrink-0">
                  <Qr value={createQuote.destination} alt="Destination XRPL address" />
                  <p
                    className="mt-2 max-w-[168px] text-[11px] leading-relaxed"
                    style={{ color: "var(--text-faint)" }}
                  >
                    Address only. No wallet reads memos from a scanned code, so the memo must be
                    pasted.
                  </p>
                </div>

                <div className="grid min-w-0 flex-1 gap-2">
                  <Copyable
                    label="Send to"
                    value={createQuote.destination}
                    hint="Read live from AssetManagerFXRP.directMintingPaymentAddress"
                  />
                  <Copyable
                    label="Exact amount (XRP)"
                    value={createQuote.amountXrp.toString()}
                    mono={false}
                    emphasis
                    hint={createQuote.netMintUBA > 0n
                      ? `Buys ${units(createQuote.netMintUBA, decimals)} ${symbol} for the rule to spend, plus fees. Underpay and the mint reverts.`
                      : `Fees only. This account already holds enough ${symbol} to cover the rule.`}
                  />
                  <Copyable
                    label="Memo (hex, required)"
                    value={toXrplHex(instruction.memoData)}
                    emphasis
                    hint="42 bytes. 0xFE opcode, then the keccak256 of the user operation."
                  />
                </div>
              </div>

              <dl
                className="mt-4 grid gap-px overflow-hidden rounded-[var(--radius)] border sm:grid-cols-3"
                style={{ borderColor: "var(--border)", background: "var(--border)" }}
              >
                <Cell label="Memo opcode">0xFE · hashed instruction</Cell>
                <Cell label="Account nonce">
                  <span className="tnum">{resolved.nonce.toString()}</span>
                </Cell>
                <Cell label="User operation">
                  <span className="tnum">{instruction.data.length / 2 - 1} bytes</span>
                </Cell>
              </dl>

              <details className="mt-4 group">
                <summary
                  className="tap cursor-pointer list-none text-[12px] font-medium select-none"
                  style={{ color: "var(--accent-text)" }}
                >
                  What the memo commits to · {instruction.calls.length} calls
                </summary>
                <div className="mt-3 grid gap-2">
                  {instruction.calls.map((c, i) => (
                    <div
                      key={c.data.slice(0, 10) + String(i)}
                      className="rounded-[var(--radius)] border p-3"
                      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                    >
                      <p
                        className="font-mono text-[10.5px] uppercase tracking-[0.14em]"
                        style={{ color: "var(--text-faint)" }}
                      >
                        Call {i + 1} → {short(c.target, 10, 8)}
                      </p>
                      <p
                        className="mt-1 break-all font-mono text-[12px] leading-snug"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {c.data.slice(0, 138)}
                        {c.data.length > 138 ? "…" : ""}
                      </p>
                    </div>
                  ))}
                  <Copyable
                    label="keccak256(user operation)"
                    value={instruction.userOpHash}
                    hint="The last 32 bytes of the memo. This is the commitment the chain checks."
                  />
                </div>
              </details>

              {registered === false && (
                <Callout tone="danger" icon={<Warning size={15} weight="fill" />}>
                  The operator did not accept this instruction, so nothing is currently
                  listening for your payment. The memo carries only a hash, so an operator
                  that has not been handed the operation cannot complete it. Paying now
                  leaves the XRP at the Core Vault until someone finishes it manually. It is
                  recoverable, but start the operator first if you can.
                </Callout>
              )}

              <Callout tone="accent" icon={<Warning size={15} weight="fill" />}>
                Send only one of these at a time. The memo is bound to nonce{" "}
                <Num>{resolved.nonce.toString()}</Num>; a second payment built from the same
                nonce reverts and its XRP is stranded at the Core Vault. Resolve again after
                each payment to pick up the new nonce.
              </Callout>
            </div>
          )}
        </Step>

        {/* --------------------------------------------------- tables --- */}
        <Panel title="Rules" hint={resolved ? `${rules.length} on this account` : undefined}>
          {!resolved ? (
            <Empty>Resolve an address to see its rules.</Empty>
          ) : rules.length === 0 ? (
            <Empty>No rules yet. Send the payment above to create one.</Empty>
          ) : (
            <Table head={["Rule", "Status", "Next run", "Runs", "Spent / cap", ""]}>
              {rules.map((r) => {
                const status = deriveStatus(r, BigInt(Math.floor(Date.now() / 1000)));
                return (
                  <tr key={r.ruleId} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td mono>{short(r.ruleId, 8, 6)}</Td>
                    <Td>
                      <Pill status={status} />
                    </Td>
                    <Td muted>
                      {/* A finished rule has a nextRunAt in the past that will
                          never arrive. "25 mins ago" would imply overdue, and a
                          bare dash makes the reader guess. */}
                      {r.active ? relativeTime(r.nextRunAt) : "Never"}
                    </Td>
                    <Td mono>
                      {r.runsDone}
                      {r.maxRuns > 0 ? ` / ${r.maxRuns}` : ""}
                    </Td>
                    <Td mono>
                      {units(r.totalSpent, decimals)} / {units(r.totalSpendCap, decimals)}
                    </Td>
                    <Td>
                      {/* Only active rules can be stopped. Offering the button
                          on a finished rule would spend 0.2 XRP and three
                          minutes to change nothing. */}
                      {r.active && (
                        <button
                          onClick={() =>
                            setStopping((cur) => (cur === r.ruleId ? null : r.ruleId))
                          }
                          className="tap inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-[12px] font-medium whitespace-nowrap"
                          style={{
                            borderColor:
                              stopping === r.ruleId ? "var(--danger)" : "var(--border-strong)",
                            color: stopping === r.ruleId ? "var(--danger)" : "var(--text-muted)",
                          }}
                        >
                          {stopping === r.ruleId ? (
                            <>
                              <X size={11} weight="bold" /> Close
                            </>
                          ) : (
                            <>
                              <Stop size={11} weight="fill" /> Stop
                            </>
                          )}
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}

          {stopping && cancelQuote && cancelInstruction && resolved && (
            <div
              className="fade-in mt-5 rounded-[var(--radius)] border p-5"
              style={{ borderColor: "var(--border-strong)", background: "var(--bg-subtle)" }}
            >
              <h3 className="text-[15px] font-semibold tracking-tight">
                Stop rule {short(stopping, 8, 6)}
              </h3>
              <p
                className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                Send one more payment, exactly like the first. It costs{" "}
                <Num>{cancelQuote.amountXrp}</Num> XRP because it mints nothing, and takes two
                to three minutes to take effect. Until it lands the rule can still spend what
                you already approved, and no more.
              </p>

              <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start">
                <div className="shrink-0">
                  <Qr value={cancelQuote.destination} alt="Destination XRPL address" />
                </div>
                <div className="grid min-w-0 flex-1 gap-2">
                  <Copyable label="Send to" value={cancelQuote.destination} />
                  <Copyable
                    label="Exact amount (XRP)"
                    value={cancelQuote.amountXrp.toString()}
                    mono={false}
                    emphasis
                    hint="Fees only. A cancel instruction mints no FXRP."
                  />
                  <Copyable
                    label="Memo (hex, required)"
                    value={toXrplHex(cancelInstruction.memoData)}
                    emphasis
                    hint={`Bound to nonce ${resolved.nonce.toString()}. Cancels the rule, then lowers the shared allowance to what your other active rules still need.`}
                  />
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Execution history">
          {!resolved || !history ? (
            <Empty>Resolve an address to see its executions.</Empty>
          ) : history.executions.length === 0 ? (
            <Empty>
              {EXECUTOR
                ? `No executions in the last ${(history.toBlock - history.fromBlock).toString()} blocks. The run counts above are read from contract state and cover all time.`
                : "Nothing has executed yet (the executor is not deployed)."}
            </Empty>
          ) : (
            <>
              <Table head={["Rule", "Moved", "Shares received", "Transaction"]}>
                {history.executions.map((e) => (
                  <tr key={e.txHash} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td mono>{short(e.ruleId, 8, 6)}</Td>
                    <Td mono>
                      {units(e.amount, decimals)} {symbol}
                    </Td>
                    <Td mono>{e.shares.toString()}</Td>
                    <Td>
                      <a
                        href={explorerTx(e.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[12px] underline decoration-1 underline-offset-4"
                        style={{ textDecorationColor: "var(--border-strong)" }}
                      >
                        {short(e.txHash, 10, 8)}
                        <ArrowSquareOut size={11} />
                      </a>
                    </Td>
                  </tr>
                ))}
              </Table>
              <p
                className="mt-3 text-[11px] leading-relaxed"
                style={{ color: "var(--text-faint)" }}
              >
                Read from <code>Deposited</code> events, blocks {history.fromBlock.toString()} to{" "}
                {history.toBlock.toString()}. Every row is a real transaction you can open.
                {history.partial && (
                  <span style={{ color: "var(--accent-text)" }}>
                    {" "}
                    Some windows failed, so this list may be incomplete. The run counts above are
                    read from contract state and are always complete.
                  </span>
                )}
              </p>
            </>
          )}
        </Panel>
      </main>
    </div>
  );
}

function Intro() {
  return (
    <div className="pt-12 pb-6 sm:pt-16 text-center">
      <h1 className="text-4xl leading-[1.1] tracking-tight sm:text-5xl font-medium">
        <span className="text-gradient font-semibold">Create a rule</span>
      </h1>
      <p
        className="mx-auto mt-4 max-w-[56ch] text-[1.0625rem] leading-relaxed"
        style={{ color: "var(--l-text-muted)" }}
      >
        Three steps. The last one is a single XRP payment, which you send from your own
        wallet. Nothing here ever asks you to connect one.
      </p>
    </div>
  );
}



/* -------------------------------------------------------------- parts --- */

/**
 * A numbered step. Numbering is used ONLY for the three sequential actions
 * (resolve, configure, pay), because there the order is real information.
 * The reference tables below are not steps and get plain headings, which also
 * keeps the page from wearing the same templated label on every section.
 */
function Step(props: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-3xl glass-card p-6 sm:p-8 shadow-lg border" style={{ borderColor: "var(--l-line)" }}>
      <div className="mb-5 flex items-center gap-3">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold tnum shadow-sm"
          style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
        >
          {props.n}
        </span>
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--l-text)" }}>{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function Panel(props: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 rounded-3xl glass-card p-6 sm:p-8 shadow-lg border" style={{ borderColor: "var(--l-line)" }}>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: "var(--l-text)" }}>{props.title}</h2>
        {props.hint !== undefined && (
          <span className="font-mono text-[11px]" style={{ color: "var(--l-text-muted)" }}>
            {props.hint}
          </span>
        )}
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-2">
      <span
        className="font-mono text-[10.5px] uppercase tracking-[0.14em]"
        style={{ color: "var(--text-faint)" }}
      >
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function Cell(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3.5" style={{ background: "var(--surface)" }}>
      <dt
        className="font-mono text-[10.5px] uppercase tracking-[0.14em]"
        style={{ color: "var(--text-faint)" }}
      >
        {props.label}
      </dt>
      <dd className="mt-1.5 flex items-center gap-2 font-mono text-[13px]">{props.children}</dd>
    </div>
  );
}

function Table(props: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr>
            {props.head.map((h) => (
              <th
                key={h}
                className="pb-2 pr-4 text-left font-mono text-[10.5px] font-normal uppercase tracking-[0.14em] last:pr-0"
                style={{ color: "var(--text-faint)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

function Td(props: { children: React.ReactNode; mono?: boolean; muted?: boolean }) {
  return (
    <td
      className={`py-3 pr-4 last:pr-0 ${props.mono === true ? "font-mono text-[12.5px] tnum" : ""}`}
      style={{ color: props.muted === true ? "var(--text-muted)" : "var(--text)" }}
    >
      {props.children}
    </td>
  );
}

/** The one place a coloured dot earns its keep: real deploy state. */
function StatusDot(props: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: props.ok ? "var(--ok)" : "var(--text-faint)" }}
    />
  );
}

function Pill(props: { status: string }) {
  const tone =
    props.status === "due" || props.status === "active"
      ? { bg: "var(--ok-subtle)", fg: "var(--ok)", border: "transparent" }
      : props.status === "cancelled"
        ? { bg: "var(--danger-subtle)", fg: "var(--danger)", border: "transparent" }
        : { bg: "var(--bg-subtle)", fg: "var(--text-muted)", border: "var(--border)" };
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11.5px] font-medium capitalize"
      style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}` }}
    >
      {props.status}
    </span>
  );
}

function Callout(props: {
  tone: "accent" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const accent = props.tone === "accent";
  return (
    <div
      className="mt-4 flex gap-2.5 rounded-[var(--radius)] border p-3.5 text-[13px] leading-relaxed"
      style={{
        borderColor: accent ? "var(--accent-border)" : "var(--danger)",
        background: accent ? "var(--accent-subtle)" : "var(--danger-subtle)",
        color: "var(--text)",
      }}
    >
      <span
        className="mt-0.5 shrink-0"
        style={{ color: accent ? "var(--accent-text)" : "var(--danger)" }}
      >
        {props.icon}
      </span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

function Empty(props: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--radius)] border border-dashed px-4 py-10 text-center text-[14px] leading-relaxed"
      style={{ borderColor: "var(--l-line-strong)", color: "var(--l-text-muted)", background: "color-mix(in srgb, var(--surface) 40%, transparent)" }}
    >
      <p className="mx-auto max-w-[56ch]">{props.children}</p>
    </div>
  );
}

function Num(props: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.92em] font-medium tnum" style={{ color: "var(--text)" }}>
      {props.children}
    </span>
  );
}
