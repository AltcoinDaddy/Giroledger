import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowSquareOut, Play, Wallet } from "@phosphor-icons/react";

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

function Landing() {
  return (
    <div className="landing min-h-[100dvh] relative overflow-hidden" style={{ background: "var(--bg)" }}>
      <SiteHeader active="home" />
      <main>
        <Hero />
        <Evidence />
      </main>
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-24 pb-16 sm:pt-32 sm:pb-32">
      <div className="hero-wash" />
      
      {/* Background grid */}
      <div className="absolute inset-0 z-0 opacity-[0.04] dark:opacity-[0.03]" 
           style={{ 
             backgroundImage: 'linear-gradient(var(--l-text) 1px, transparent 1px), linear-gradient(90deg, var(--l-text) 1px, transparent 1px)', 
             backgroundSize: '4rem 4rem',
             maskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)',
             WebkitMaskImage: 'radial-gradient(ellipse at center, black 40%, transparent 80%)'
           }} 
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 text-center sm:px-8">
        <Reveal>
          <h1 className="mx-auto max-w-4xl text-4xl leading-tight sm:text-5xl md:text-6xl lg:text-[4.2rem] font-medium tracking-tight">
            One XRP payment.<br className="hidden sm:block" />
            {" "}
            <span className="text-gradient font-semibold"> Then it runs itself</span>
          </h1>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="mx-auto mt-7 max-w-2xl text-[1.0625rem] leading-[1.75] sm:text-[1.125rem]" style={{ color: "var(--l-text-muted)" }}>
            A single XRP Ledger payment becomes a recurring on-chain rule. No FLR, no EVM wallet, no bridge.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-5">
            <Link
              to="/app"
              className="tap flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-medium transition-transform hover:scale-[1.02]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow: "0 8px 24px -6px var(--accent)",
              }}
            >
              <Wallet size={18} weight="fill" />
              Create a rule now
            </Link>
            <Link 
              to="/about" 
              className="tap flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-medium border transition-colors hover:bg-[var(--surface-hover)]"
              style={{ 
                borderColor: "var(--l-line-strong)",
                color: "var(--l-text)",
                background: "var(--bg)"
              }}
            >
              <Play size={18} weight="fill" style={{ color: "var(--accent)" }} />
              How it works?
            </Link>
          </div>
        </Reveal>

        {/* Floating Widgets Area */}
        <div className="relative mt-24 h-[340px] w-full max-w-4xl mx-auto sm:h-[400px]">
          {/* Main center card */}
          <Reveal delay={0.3}>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-64 sm:w-[20rem] overflow-hidden rounded-3xl glass-card float-1 p-6 shadow-2xl">
               <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 flex items-center justify-center">
                      <svg viewBox="0 0 36.7 36.6" className="w-full h-full" fill="#E62058">
                        <path d="M27.3,13.7H9.2c-5,0-9,3.9-9.2,8.9c0,0.1,0.1,0.2,0.2,0.2h18.1c5,0,9-3.9,9.2-8.9C27.5,13.8,27.4,13.7,27.3,13.7z"/>
                        <path d="M36.4,0H9.2c-5,0-9,3.9-9.2,8.9C0,9,0.1,9.2,0.2,9.2h27.3c5,0,9-3.9,9.2-8.9C36.7,0.1,36.6,0,36.4,0z"/>
                        <circle cx="4.6" cy="32" r="4.6"/>
                      </svg>
                    </div>
                    <span className="font-medium text-lg text-[var(--l-text)]">Flare Network</span>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-green-100/80 text-green-700 font-medium dark:bg-green-900/40 dark:text-green-400">Active</span>
               </div>
               <div className="mb-2">
                 <span className="text-[2.25rem] font-light tracking-tight text-[var(--l-text)]">$32,831</span><span className="text-xl text-[var(--l-text-faint)]">.69</span>
               </div>
               <div className="flex items-center justify-between">
                 <p className="text-[13px]" style={{ color: "var(--l-text-muted)" }}>Limit is <strong className="font-semibold text-[var(--l-text)]">$30k</strong> a month.</p>
                 <div className="w-6 h-6 rounded-full bg-[var(--l-text)] text-[var(--bg)] flex items-center justify-center font-bold text-lg leading-none pb-[2px] cursor-pointer hover:scale-110 transition-transform">+</div>
               </div>
            </div>
          </Reveal>

          {/* Left card */}
          <Reveal delay={0.4}>
            <div className="absolute left-0 sm:left-4 top-16 sm:top-24 z-10 w-56 overflow-hidden rounded-3xl glass-card float-2 p-5 shadow-xl opacity-95 scale-90 sm:scale-100">
               <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 flex items-center justify-center">
                      <svg viewBox="0 0 32 32" className="w-full h-full">
                        <circle cx="16" cy="16" r="16" fill="#23292F"/>
                        <path d="M23.07 8h2.89l-6.015 5.957a5.621 5.621 0 01-7.89 0L6.035 8H8.93l4.57 4.523a3.556 3.556 0 004.996 0L23.07 8zM8.895 24.563H6l6.055-5.993a5.621 5.621 0 017.89 0L26 24.562h-2.895L18.5 20a3.556 3.556 0 00-4.996 0l-4.61 4.563z" fill="#FFF"/>
                      </svg>
                    </div>
                    <span className="font-medium text-[var(--l-text)]">XRP Ledger</span>
                  </div>
               </div>
               <div className="mb-2">
                 <span className="text-2xl font-light text-[var(--l-text)]">$29,352</span><span className="text-sm font-medium text-red-500">.74</span>
               </div>
               <div className="flex justify-between items-center">
                 <p className="text-xs" style={{ color: "var(--l-text-muted)" }}>Limit is <strong className="text-[var(--l-text)]">$30k</strong> a month.</p>
                 <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 text-red-600 font-medium dark:border-red-900 dark:text-red-400">Active</span>
               </div>
            </div>
          </Reveal>

          {/* Right card */}
          <Reveal delay={0.5}>
            <div className="absolute right-0 sm:right-4 top-20 sm:top-12 z-30 w-56 overflow-hidden rounded-3xl glass-card float-3 p-5 shadow-xl opacity-95 scale-90 sm:scale-100" style={{ background: 'color-mix(in srgb, var(--surface) 80%, transparent)' }}>
               <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 flex items-center justify-center">
                      <svg viewBox="0 0 32 32" className="w-full h-full">
                        <circle cx="16" cy="16" r="16" fill="#23292F"/>
                        <path d="M23.07 8h2.89l-6.015 5.957a5.621 5.621 0 01-7.89 0L6.035 8H8.93l4.57 4.523a3.556 3.556 0 004.996 0L23.07 8zM8.895 24.563H6l6.055-5.993a5.621 5.621 0 017.89 0L26 24.562h-2.895L18.5 20a3.556 3.556 0 00-4.996 0l-4.61 4.563z" fill="#FFF"/>
                      </svg>
                    </div>
                    <span className="font-medium text-[var(--l-text)]">XRP Payment</span>
                  </div>
               </div>
               <div className="mb-2">
                 <span className="text-2xl font-light text-[var(--l-text)]">$19,251</span><span className="text-sm font-medium text-blue-500">.67</span>
               </div>
               <div className="flex justify-between items-center">
                 <p className="text-xs" style={{ color: "var(--l-text-muted)" }}>Limit is <strong className="text-[var(--l-text)]">$30k</strong> a month.</p>
                 <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-200 text-blue-600 font-medium dark:border-blue-900 dark:text-blue-400">Active</span>
               </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-8 flex justify-center opacity-60 hover:opacity-100 transition-opacity">
           <a href="#evidence" className="flex items-center gap-2 text-sm font-medium tap" style={{ color: "var(--l-text-faint)" }}>
             Scroll to explore 
             <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
               <ArrowRight size={12} weight="bold" className="rotate-90" />
             </div>
           </a>
        </div>
      </div>
    </section>
  );
}

function Label(props: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-medium uppercase tracking-wider" style={{ color: "var(--l-text-faint)" }}>
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
    <section id="evidence" className="relative py-28 sm:py-36" style={{ background: "var(--bg-subtle)" }}>
      <div className="mx-auto w-full max-w-5xl px-6 sm:px-8">
        
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-20 items-center">
          <Reveal>
            <div className="max-w-xl">
              <h2 className="text-[2.25rem] leading-[1.15] sm:text-[3rem] font-medium tracking-tight">
                Every claim here is a transaction you can open.
              </h2>
              <p
                className="mt-6 text-[16px] leading-[1.75]"
                style={{ color: "var(--l-text-muted)" }}
              >
                Running on Flare Coston2. Contract source is verified on Blockscout and Sourcify,
                so you can read what these transactions actually called. Real executions of your rules, secured on-chain.
              </p>
              
              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 font-mono text-[12px]">
                {REGISTRY && <ContractLink label="RuleRegistry" address={REGISTRY} />}
                {EXECUTOR && <ContractLink label="RuleExecutor" address={EXECUTOR} />}
                <ContractLink label="Account in examples" address={ACCOUNT} />
              </div>
            </div>
          </Reveal>
          
          {/* The real artifact, preserved from original, styled to match glass theme */}
          <Reveal delay={0.2} y={30}>
            <div
              className="hero-shot overflow-hidden rounded-[var(--l-radius-lg)] border p-7 text-left sm:p-9 glass-card"
              style={{
                borderColor: "var(--l-line-strong)",
                background: "color-mix(in srgb, var(--surface) 90%, transparent)",
              }}
            >
              <div className="grid gap-10">
                <div>
                  <Label>The payment to send</Label>
                  <div className="mt-5 flex items-start gap-5">
                    <div className="p-2 bg-white rounded-xl shadow-sm inline-block">
                      <Qr value={CORE_VAULT} size={94} alt="Destination XRP Ledger address" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Line label="To" value={`${CORE_VAULT.slice(0, 9)}…${CORE_VAULT.slice(-4)}`} />
                      <Line label="Amount" value="10.2 XRP" />
                    </div>
                  </div>
                  <div className="mt-5 p-3 rounded-xl" style={{ background: "var(--bg-subtle)" }}>
                    <p
                      className="break-all font-mono text-[10px] leading-[1.8]"
                      style={{ color: "var(--l-text-faint)" }}
                    >
                      {REAL_MEMO}
                    </p>
                  </div>
                </div>

                <div>
                  <Label>What happened next</Label>
                  <div
                    className="mt-4 grid gap-[1px] overflow-hidden rounded-[var(--l-radius)] border"
                    style={{ background: "var(--l-line)", borderColor: "var(--l-line)" }}
                  >
                    {SHOT_ROWS.map((r) => (
                      <div
                        key={r.hash}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 text-[13px] hover:bg-[var(--surface-hover)] transition-colors"
                        style={{ background: "var(--l-surface)" }}
                      >
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                          style={{ background: "var(--ok-subtle)", color: "var(--ok)" }}
                        >
                          {r.state}
                        </span>
                        <span className="font-mono tnum font-medium">{r.moved}</span>
                        <span className="font-mono tnum" style={{ color: "var(--l-text-muted)" }}>
                          {r.shares}
                        </span>
                        <span className="ml-auto font-mono text-[11px] hidden sm:inline" style={{ color: "var(--l-text-faint)" }}>
                          {r.hash}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-32 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROOFS.map((p, i) => (
            <Reveal key={p.href} delay={i * 0.06} y={16}>
              <a
                href={p.href}
                target="_blank"
                rel="noreferrer"
                className="tap flex h-full flex-col justify-between gap-6 rounded-[var(--l-radius-lg)] p-8 glass-card border border-[var(--l-line)] transition-all hover:-translate-y-1 hover:shadow-lg hover:border-[var(--l-line-strong)]"
                style={{ background: "var(--l-surface)" }}
              >
                <div>
                  <h3 className="text-[1.125rem] font-medium leading-snug">{p.claim}</h3>
                  <p
                    className="mt-3 text-[14px] leading-[1.7]"
                    style={{ color: "var(--l-text-muted)" }}
                  >
                    {p.detail}
                  </p>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[12px] font-medium"
                  style={{ color: "var(--accent-text)" }}
                >
                  {p.label}
                  <ArrowSquareOut size={12} weight="bold" />
                </span>
              </a>
            </Reveal>
          ))}
        </div>

        {/* Three measured figures */}
        <Reveal>
          <div
            className="mt-20 grid gap-10 border-t pt-14 sm:grid-cols-3"
            style={{ borderColor: "var(--l-line)" }}
          >
            {FIGURES.map((f) => (
              <div key={f.label}>
                <p className="flex items-baseline gap-2">
                  <span className="text-[3rem] font-medium leading-none tnum text-gradient">{f.value}</span>
                  <span className="text-[16px] font-medium" style={{ color: "var(--l-text-muted)" }}>
                    {f.unit}
                  </span>
                </p>
                <p className="mt-3 text-[15px]" style={{ color: "var(--l-text-muted)" }}>
                  {f.label}
                </p>
              </div>
            ))}
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
      className="tap inline-flex items-center gap-1.5 hover:opacity-75 transition-opacity"
      style={{ color: "var(--l-text-muted)" }}
    >
      <span style={{ color: "var(--l-text-faint)" }}>{props.label}</span>
      {props.address.slice(0, 8)}…{props.address.slice(-4)}
    </a>
  );
}

/* ------------------------------------------------------------- footer --- */

function Footer() {
  return (
    <footer className="relative" style={{ borderTop: "1px solid var(--l-line)", background: "var(--bg)" }}>
      <div className="mx-auto w-full max-w-5xl px-6 py-24 sm:px-8 text-center">
        <Reveal y={16}>
          <h2 className="mx-auto max-w-[20ch] text-[2.25rem] leading-[1.2] sm:text-[3rem] font-medium tracking-tight">
            Try it with any XRP address.
          </h2>
          <p
            className="mx-auto mt-6 max-w-[46ch] text-[1.125rem] leading-[1.75]"
            style={{ color: "var(--l-text-muted)" }}
          >
            Nothing is signed until you send the payment yourself. Join the secure, decentralized network.
          </p>
          <Link
            to="/app"
            className="tap mx-auto mt-12 inline-flex items-center justify-center gap-2 rounded-full px-9 py-4 text-[16px] font-medium transition-transform hover:scale-[1.02]"
            style={{
              background: "var(--accent)",
              color: "var(--accent-fg)",
              boxShadow: "0 8px 24px -6px var(--accent)",
            }}
          >
            <Wallet size={20} weight="fill" />
            Create a rule now
          </Link>
        </Reveal>

        <div
          className="mt-28 flex flex-col md:flex-row items-center justify-between gap-6 border-t pt-10 text-[13px] leading-[1.7]"
          style={{ borderColor: "var(--l-line)", color: "var(--l-text-faint)" }}
        >
          <p className="max-w-[52ch] text-left md:text-left">
            Coston2 testnet only, not audited, no real value. An operator has to complete each
            payment and cannot forge one.{" "}
            <Link to="/about" className="tap font-medium underline underline-offset-[3px] hover:text-[var(--l-text)] transition-colors">
              What it cannot do yet
            </Link>
            .
          </p>
          <div className="flex items-center gap-4">
            <span className="font-medium">Follow Us</span>
            <div className="flex gap-2">
              {['X', 'f', 'in'].map(icon => (
                <span key={icon} className="w-8 h-8 rounded-full border flex items-center justify-center cursor-pointer transition-colors" 
                  style={{ borderColor: "var(--l-line-strong)", background: "var(--surface)" }}>
                  {icon}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
