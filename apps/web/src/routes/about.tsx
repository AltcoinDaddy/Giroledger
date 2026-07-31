import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowSquareOut } from "@phosphor-icons/react";

import { SiteHeader } from "../components/SiteHeader";
import { Reveal } from "../components/Reveal";

export const Route = createFileRoute("/about")({ component: About });

const tx = (h: string) => `https://coston2-explorer.flare.network/tx/${h}`;
const addr = (a: string) => `https://coston2-explorer.flare.network/address/${a}`;

const CONTRACTS = [
  {
    name: "RuleRegistry",
    address: "0xd430b9E2756b26F616C0b1C88b0707898D057ce6",
    role: "Stores rules and enforces the interval, the run count and the spend cap. It never touches funds.",
  },
  {
    name: "RuleExecutor",
    address: "0x10E74799fde0c5f26d14EA83b6e837cA0115A546",
    role: "The only contract that moves money. Permissionless: anyone can trigger a due rule, and it holds a zero balance between transactions.",
  },
];

/** Bugs worth writing down, because each one was only findable on a real chain. */
const LESSONS = [
  {
    title: "A gas estimate that was confidently wrong",
    body: "Batched execution catches individual failures so one bad rule cannot block the rest. The cost is that the outer call succeeds even when an inner call runs out of gas, which blinds eth_estimateGas: it returned 316,693 for a call needing 316,021, and under EIP-150 the inner call received only about 311,000 of it. Sixty consecutive batches reported success having executed nothing. The fix gives the estimator a revert to find, and the keeper now reads what actually happened rather than the receipt status.",
  },
  {
    title: "One allowance, several rules",
    body: "Every rule on an account shares a single ERC-20 approval, and approve sets it absolutely rather than adding to it. Creating a second rule therefore wiped out the first rule's headroom, and cancelling any rule stopped all of them. Found when a live rule sat due with eight runs remaining and nothing left to draw. It could never have overspent, because each rule's cap is enforced separately, but it could and did leave rules stuck.",
  },
  {
    title: "A vault list that moved",
    body: "Flare's registry returned one address for Firelight vault 1 on one day and a different address for the same id the next, while the original kept working. Nothing here hardcodes a vault, and a diagnostic prints Flare's list beside our allowlist so the two can be compared before a payment is sent.",
  },
];

function About() {
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
      <SiteHeader active="about" />

      <main className="relative z-10 mx-auto w-full max-w-4xl px-5 pt-16 pb-24 sm:px-8 sm:pt-24">
        <Reveal>
          <h1 className="text-4xl leading-[1.08] font-medium tracking-tight sm:text-5xl text-center">
            <span className="text-gradient font-semibold">What this is,</span> and what it is not.
          </h1>
          <p
            className="mt-6 text-lg leading-relaxed text-center mx-auto max-w-2xl"
            style={{ color: "var(--l-text-muted)" }}
          >
            GiroLedger is a prototype built for Flare Summer Signal. It turns a single XRP
            Ledger payment into a recurring on-chain rule, and it runs on Coston2 with real
            transactions you can open.
          </p>
        </Reveal>

        <Block title="The problem">
          <P>
            An XRP holder who wants a position that earns has to acquire a second asset for
            gas, install an EVM wallet, learn a bridge, and then keep signing transactions
            forever. Most people stop at step one, and the ones who do not still have to show
            up manually every time.
          </P>
          <P>
            Flare Smart Accounts removes the first four steps: every XRPL address already
            controls an account on Flare, driven by ordinary XRP payments. What was missing is
            the last one. An account you can reach with a payment is still an account you have
            to keep paying attention to.
          </P>
        </Block>

        <Block title="What it does">
          <P>
            One payment carries a 42-byte memo describing a rule: how much, how often, how
            many times, and into which vault. The XRPL signature on that payment is the entire
            authorisation. There is no wallet to connect and no second approval.
          </P>
          <P>
            Two services then do the rest, and neither can act on its own authority. An
            operator turns the payment into a rule: it asks the Flare Data Connector to
            attest the payment and submits the proof. It cannot invent an instruction,
            because the memo commits to one exact hash and the attestation proves the payment
            independently. A keeper then triggers the rule when it comes due and pays the gas,
            holding no funds and no permission the rest of the world lacks.
          </P>
          <P>
            Vault shares are minted straight to the user's own account, never to either
            service. Stopping a rule is one more payment, costing 0.2 XRP.
          </P>
        </Block>

        <Block title="What is actually running">
          <P>
            Two contracts on Coston2, source verified on Blockscout and Sourcify. Thirty-four
            Solidity tests and sixty-one TypeScript tests pass, including fuzzing and a
            hostile-vault reentrancy test.
          </P>
          <dl className="mt-6">
            {CONTRACTS.map((c) => (
              <div
                key={c.address}
                className="border-t py-5"
                style={{ borderColor: "var(--border)" }}
              >
                <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-semibold tracking-tight">{c.name}</span>
                  <a
                    href={addr(c.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-[12px] underline decoration-1 underline-offset-4"
                    style={{
                      color: "var(--text-muted)",
                      textDecorationColor: "var(--border-strong)",
                    }}
                  >
                    {c.address.slice(0, 10)}…{c.address.slice(-4)}
                    <ArrowSquareOut size={11} />
                  </a>
                </dt>
                <dd
                  className="mt-1.5 text-[15px] leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  {c.role}
                </dd>
              </div>
            ))}
          </dl>
        </Block>

        <Block title="Three things that went wrong">
          <P>
            Written down because each was only findable by running against a real chain, and
            because a build log with no failures in it is not a build log.
          </P>
          <div className="mt-6 grid gap-7">
            {LESSONS.map((l) => (
              <div key={l.title}>
                <h3 className="text-[16px] font-semibold tracking-tight">{l.title}</h3>
                <p
                  className="mt-1.5 text-[15px] leading-relaxed"
                  style={{ color: "var(--text-muted)" }}
                >
                  {l.body}
                </p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="What it is not">
          <P>
            It is not audited, it is not on mainnet, and the FXRP here is testnet play money.
            The owner can pause all executions, which is a safety valve for a prototype and
            would be timelocked or removed before real funds were involved.
          </P>
          <P>
            Price-triggered rules are not implemented. The registry rejects them outright
            rather than half-supporting them. Stopping a rule takes two to three minutes,
            because it waits for an attestation round, and the spend cap you already approved
            is what bounds that window.
          </P>
        </Block>

        <Reveal>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 pt-8">
            <Link
              to="/app"
              className="tap inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-medium transition-transform hover:scale-[1.02]"
              style={{
                background: "var(--accent)",
                color: "var(--accent-fg)",
                boxShadow: "0 8px 24px -6px var(--accent)",
              }}
            >
              Create a rule
              <ArrowRight size={16} weight="bold" />
            </Link>
            <a
              href={tx("0x1c5d1a15c287a40c5cbd7923a592d1e7124c734027f19ba6293b89d0eee9d3c0")}
              target="_blank"
              rel="noreferrer"
              className="tap inline-flex items-center justify-center gap-2 rounded-full px-8 py-3.5 text-[15px] font-medium border transition-colors hover:bg-[var(--surface-hover)]"
              style={{ 
                borderColor: "var(--l-line-strong)",
                color: "var(--l-text)",
                background: "var(--bg)"
              }}
            >
              See one execute
              <ArrowSquareOut size={15} weight="bold" />
            </a>
          </div>
        </Reveal>
      </main>
    </div>
  );
}

function Block(props: { title: string; children: React.ReactNode }) {
  return (
    <Reveal y={20}>
      <section className="mt-12 rounded-3xl glass-card p-7 sm:p-10 shadow-lg border" style={{ borderColor: "var(--l-line)" }}>
        <h2 className="text-[1.75rem] font-semibold tracking-tight" style={{ color: "var(--l-text)" }}>{props.title}</h2>
        <div className="mt-5">{props.children}</div>
      </section>
    </Reveal>
  );
}

function P(props: { children: React.ReactNode }) {
  return (
    <p
      className="mt-4 max-w-[68ch] text-[16px] leading-relaxed first:mt-0"
      style={{ color: "var(--l-text-muted)" }}
    >
      {props.children}
    </p>
  );
}
