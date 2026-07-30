import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowSquareOut } from "@phosphor-icons/react";

import { SiteHeader } from "../components/SiteHeader";
import { Reveal } from "../components/Reveal";
import { Qr } from "../components/Qr";
import {
  ACCOUNT,
  addr,
  CORE_VAULT,
  EXECUTOR,
  REAL_MEMO,
  REGISTRY,
  SHOT_ROWS,
  tx,
  TX,
} from "../lib/evidence";

export const Route = createFileRoute("/")({ component: Landing });

/**
 * Landing page. Dials: VARIANCE 6 / MOTION 5 / DENSITY 2. Monochrome.
 *
 * FOUR BLOCKS ONLY: nav, hero, evidence, footer.
 *
 * It previously ran seven sections. The cut was not cosmetic. How-it-works,
 * why-Flare and the limitations all now live on /about, where someone who wants
 * them will look, and repeating them here made the page a document rather than
 * a decision. What is left is the claim, the artifact that proves it, and the
 * way in.
 *
 * The evidence section survives rather than how-it-works because it is the only
 * part a competitor cannot write. Anyone can describe a mechanism; these are
 * transactions on a public chain.
 */
function Landing() {
  return (
    <div className="landing min-h-[100dvh]" style={{ background: "var(--bg)" }}>
      <SiteHeader active="home" />
      <main>
        <Hero />
        <Evidence />
      </main>
      <Footer />
    </div>
  );
}

/* --------------------------------------------------------------- hero --- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-wash" />

      <div className="mx-auto w-full max-w-4xl px-6 pt-24 text-center sm:px-8 sm:pt-32">
        <h1
          className="rise mx-auto max-w-[16ch] text-[2.75rem] leading-[1.06] sm:text-6xl lg:text-[4.5rem]"
          style={{ "--i": 0 } as React.CSSProperties}
        >
          One XRP payment. Then it runs itself.
        </h1>

        <p
          className="rise mx-auto mt-7 max-w-[46ch] text-[1.0625rem] leading-[1.75] sm:text-lg"
          style={{ color: "var(--l-text-muted)", "--i": 1 } as React.CSSProperties}
        >
          A single XRP Ledger payment becomes a recurring on-chain rule. No FLR, no EVM
          wallet, no bridge.
        </p>

        <div
          className="rise mt-11 flex flex-wrap items-center justify-center gap-x-7 gap-y-4"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <Link
            to="/app"
            className="tap inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-medium"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              boxShadow: "var(--l-raised)",
            }}
          >
            Create a rule
            <ArrowRight size={16} />
          </Link>
          <Link to="/about" className="tap text-[15px]" style={{ color: "var(--l-text-muted)" }}>
            How it works
          </Link>
        </div>
      </div>

      {/*
        The real artifact, not a picture of a product. Real destination, real
        amount, real 42-byte memo, taken from the payment that created the rule
        it links to. Cropped by the fold the way a screenshot would be.
      */}
      <div
        className="rise mx-auto mt-20 w-full max-w-[58rem] px-6 sm:px-8"
        style={{ "--i": 3 } as React.CSSProperties}
      >
        <div
          className="hero-shot max-h-[24rem] overflow-hidden rounded-t-[var(--l-radius-lg)] border border-b-0 p-6 text-left sm:max-h-[28rem] sm:p-9"
          style={{
            borderColor: "var(--l-line)",
            background: "var(--l-surface)",
            boxShadow: "var(--l-lifted)",
          }}
        >
          <div className="grid gap-10 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <div>
              <Label>The payment to send</Label>
              <div className="mt-4 flex items-start gap-5">
                <Qr value={CORE_VAULT} size={94} alt="Destination XRP Ledger address" />
                <div className="min-w-0 flex-1">
                  <Line label="To" value={`${CORE_VAULT.slice(0, 9)}…${CORE_VAULT.slice(-4)}`} />
                  <Line label="Amount" value="10.2 XRP" />
                </div>
              </div>
              <p
                className="mt-4 break-all font-mono text-[10px] leading-[1.8]"
                style={{ color: "var(--l-text-faint)" }}
              >
                {REAL_MEMO}
              </p>
            </div>

            <div>
              <Label>What happened next</Label>
              <div
                className="mt-4 grid gap-px overflow-hidden rounded-[var(--l-radius)]"
                style={{ background: "var(--l-line)" }}
              >
                {SHOT_ROWS.map((r) => (
                  <div
                    key={r.hash}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]"
                    style={{ background: "var(--l-surface)" }}
                  >
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px]"
                      style={{ background: "var(--ok-subtle)", color: "var(--ok)" }}
                    >
                      {r.state}
                    </span>
                    <span className="font-mono tnum">{r.moved}</span>
                    <span className="font-mono tnum" style={{ color: "var(--l-text-muted)" }}>
                      {r.shares}
                    </span>
                    <span className="ml-auto font-mono" style={{ color: "var(--l-text-faint)" }}>
                      {r.hash}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[12px] leading-[1.7]" style={{ color: "var(--l-text-faint)" }}>
                Real executions of{" "}
                <a
                  href={tx(TX.create)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-[3px]"
                  style={{
                    color: "var(--accent-text)",
                    textDecorationColor: "var(--l-line-strong)",
                  }}
                >
                  this rule
                </a>
                . Nothing on this panel is illustrative.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Label(props: { children: React.ReactNode }) {
  return (
    <p className="text-[12px]" style={{ color: "var(--l-text-faint)" }}>
      {props.children}
    </p>
  );
}

function Line(props: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[11px]" style={{ color: "var(--l-text-faint)" }}>
        {props.label}
      </p>
      <p className="font-mono text-[13px] tnum">{props.value}</p>
    </div>
  );
}

/* ----------------------------------------------------------- evidence --- */

const PROOFS = [
  {
    claim: "An XRP payment can call a contract on Flare",
    detail: "One payment executed three arbitrary calls through a Smart Account.",
    href: tx(TX.smartAccount),
    label: "0xeda8fab5…ab89",
  },
  {
    claim: "One payment creates a rule",
    detail: "RuleCreated, 90 seconds end to end, from a wallet holding only XRP.",
    href: tx(TX.create),
    label: "0x332cb114…4770",
  },
  {
    claim: "It runs with nobody watching",
    detail: "A keeper executed the rule and the shares landed in the user's account.",
    href: tx(TX.execute),
    label: "0x1c5d1a15…d3c0",
  },
  {
    claim: "A second payment stops it",
    detail: "Cancelled with 8 of 10 runs unused. Cost 0.2 XRP, took 175 seconds.",
    href: tx(TX.cancel),
    label: "0xdf26dfa5…b28b",
  },
];

const FIGURES = [
  { value: "0.2", unit: "XRP", label: "to stop a rule" },
  { value: "90", unit: "seconds", label: "to create one" },
  { value: "0", unit: "FLR", label: "needed to use it" },
];

function Evidence() {
  return (
    <section
      className="py-28 sm:py-36"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-8">
        <Reveal>
          <h2 className="max-w-[22ch] text-[2rem] leading-[1.15] sm:text-[2.75rem]">
            Every claim here is a transaction you can open.
          </h2>
          <p
            className="mt-5 max-w-[56ch] text-[16px] leading-[1.75]"
            style={{ color: "var(--l-text-muted)" }}
          >
            Running on Flare Coston2. Contract source is verified on Blockscout and Sourcify,
            so you can read what these transactions actually called.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2">
          {PROOFS.map((p, i) => (
            <Reveal key={p.href} delay={i * 0.06} y={16}>
              <a
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="tap flex h-full flex-col justify-between gap-8 rounded-[var(--l-radius-lg)] p-7"
                style={{ background: "var(--l-surface)", boxShadow: "var(--l-raised)" }}
              >
                <div>
                  <h3 className="text-[1.125rem] leading-snug">{p.claim}</h3>
                  <p
                    className="mt-2.5 text-[15px] leading-[1.7]"
                    style={{ color: "var(--l-text-muted)" }}
                  >
                    {p.detail}
                  </p>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[12px]"
                  style={{ color: "var(--accent-text)" }}
                >
                  {p.label}
                  <ArrowSquareOut size={12} />
                </span>
              </a>
            </Reveal>
          ))}
        </div>

        {/* Three measured figures, kept because they are the shortest possible
            version of the whole pitch. */}
        <Reveal>
          <div
            className="mt-16 grid gap-10 border-t pt-12 sm:grid-cols-3"
            style={{ borderColor: "var(--l-line)" }}
          >
            {FIGURES.map((f) => (
              <div key={f.label}>
                <p className="flex items-baseline gap-2">
                  <span className="text-[2.5rem] leading-none tnum">{f.value}</span>
                  <span className="text-[15px]" style={{ color: "var(--l-text-muted)" }}>
                    {f.unit}
                  </span>
                </p>
                <p className="mt-3 text-[14px]" style={{ color: "var(--l-text-muted)" }}>
                  {f.label}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal>
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-2.5 font-mono text-[11.5px]">
            {REGISTRY && <ContractLink label="RuleRegistry" address={REGISTRY} />}
            {EXECUTOR && <ContractLink label="RuleExecutor" address={EXECUTOR} />}
            <ContractLink label="Account in these examples" address={ACCOUNT} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ContractLink(props: { label: string; address: string }) {
  return (
    <a
      href={addr(props.address)}
      target="_blank"
      rel="noreferrer"
      className="tap inline-flex items-center gap-1.5"
      style={{ color: "var(--l-text-muted)" }}
    >
      <span style={{ color: "var(--l-text-faint)" }}>{props.label}</span>
      {props.address.slice(0, 8)}…{props.address.slice(-4)}
    </a>
  );
}

/* ------------------------------------------------------------- footer --- */

/**
 * Carries the closing action and the honesty that used to have its own section.
 * Cutting the limitations block would have been the wrong kind of tidying, so
 * the substance moved here and the detail moved to /about.
 */
function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--l-line)" }}>
      <div className="mx-auto w-full max-w-4xl px-6 py-20 sm:px-8 sm:py-24">
        <Reveal y={16}>
          <h2 className="max-w-[18ch] text-[1.75rem] leading-[1.2] sm:text-[2.25rem]">
            Try it with any XRP address.
          </h2>
          <p
            className="mt-5 max-w-[46ch] text-[16px] leading-[1.75]"
            style={{ color: "var(--l-text-muted)" }}
          >
            Nothing is signed until you send the payment yourself.
          </p>
          <Link
            to="/app"
            className="tap mt-8 inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-[15px] font-medium"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              boxShadow: "var(--l-raised)",
            }}
          >
            Create a rule
            <ArrowRight size={16} />
          </Link>
        </Reveal>

        <div
          className="mt-20 flex flex-wrap items-end justify-between gap-6 border-t pt-8 text-[12.5px] leading-[1.7]"
          style={{ borderColor: "var(--l-line)", color: "var(--l-text-faint)" }}
        >
          <p className="max-w-[52ch]">
            Coston2 testnet only, not audited, no real value. An operator has to complete each
            payment and cannot forge one.{" "}
            <Link to="/about" className="tap underline underline-offset-[3px]">
              What it cannot do yet
            </Link>
            .
          </p>
          <p>GiroLedger. Built for Flare Summer Signal.</p>
        </div>
      </div>
    </footer>
  );
}
