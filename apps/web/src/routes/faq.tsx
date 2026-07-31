import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "../components/SiteHeader";
import { Reveal } from "../components/Reveal";

export const Route = createFileRoute("/faq")({ component: FAQ });

function FAQItem(props: { question: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details
      className="group glass-card rounded-2xl border mb-4 overflow-hidden"
      style={{ borderColor: "var(--l-line)" }}
      open={props.open}
    >
      <summary
        className="flex cursor-pointer items-center justify-between px-6 py-5 font-semibold text-lg list-none [&::-webkit-details-marker]:hidden select-none"
        style={{ color: "var(--l-text)" }}
      >
        {props.question}
        <span className="text-[14px] transition-transform group-open:rotate-180" style={{ color: "var(--l-text-muted)" }}>
          ▼
        </span>
      </summary>
      <div className="px-6 pb-6 text-[15px] leading-relaxed space-y-4" style={{ color: "var(--l-text-muted)" }}>
        {props.children}
      </div>
    </details>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section className="mt-16 sm:mt-20">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl mb-8" style={{ color: "var(--l-text)" }}>
          {props.title}
        </h2>
        <div>{props.children}</div>
      </section>
    </Reveal>
  );
}

function P(props: { children: React.ReactNode }) {
  return <p>{props.children}</p>;
}

function FAQ() {
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
      <SiteHeader active="faq" />

      <main className="relative z-10 mx-auto w-full max-w-3xl px-5 pt-16 pb-24 sm:px-8 sm:pt-24">
        <Reveal>
          <h1 className="text-4xl leading-[1.08] font-medium tracking-tight sm:text-5xl text-center">
            <span className="text-gradient font-semibold">Frequently Asked Questions</span>
          </h1>
          <p
            className="mt-6 text-lg leading-relaxed text-center mx-auto max-w-2xl"
            style={{ color: "var(--l-text-muted)" }}
          >
            Everything you need to know about GiroLedger, from how it works to trust and safety.
          </p>
        </Reveal>

        <Section title="The basics">
          <FAQItem question="What is GiroLedger?">
            <P>It is a standing order for XRP.</P>
            <P>
              You tell a bank once to move £50 into savings on the first of every month, and
              then you forget about it. GiroLedger is that, except the bank is a blockchain,
              nobody can freeze it, and nobody can change the terms behind your back.
            </P>
            <P>
              You send one XRP payment. That payment sets up a rule. The rule then runs by
              itself, over and over, until you stop it.
            </P>
          </FAQItem>

          <FAQItem question="What problem does it actually solve?">
            <P>Two problems, and the second one is the harder of the two.</P>
            <P>
              The obvious one is effort. Putting XRP into a yield product every week means
              showing up every week, forever. Most people don't.
            </P>
            <P>
              The real one is access. An XRP holder can't easily reach these products at all.
              It would mean buying a second coin just to pay for gas, installing an EVM
              wallet, learning a bridge, and keeping both in sync. Most people stop at step
              one. GiroLedger removes all of it: one payment, from the XRP wallet you already
              have.
            </P>
          </FAQItem>

          <FAQItem question="So it is a cron job?">
            <P>
              Only if you skip the first half. Automation on its own would be a cron job. The
              part that makes this new is that an XRP holder can hold an on-chain position at
              all without a second wallet or a gas token, and that every Flare Smart Accounts
              instruction before this one was single-shot. This is the recurring one.
            </P>
          </FAQItem>

          <FAQItem question="Do I need FLR, an EVM wallet, or a bridge?">
            <P>
              No, no, and no. Your XRP wallet is the only thing you need. The signature on
              your XRP payment is the entire authorisation.
            </P>
          </FAQItem>
        </Section>

        <Section title="Using it">
          <FAQItem question="How do I set one up?">
            <P>Three steps on the site, then one payment from your own wallet.</P>
            <ol className="list-decimal pl-5 space-y-2 mt-2">
              <li>
                <strong style={{ color: "var(--l-text)" }}>Paste your XRP address.</strong> The page works out which account on Flare
                belongs to it and shows you the address and balance. That account already
                exists and is already yours. You have simply never used it.
              </li>
              <li>
                <strong style={{ color: "var(--l-text)" }}>Describe the standing order.</strong> How much per run, how many runs, how often,
                and which vault it goes into.
              </li>
              <li>
                <strong style={{ color: "var(--l-text)" }}>Send one payment.</strong> The page gives you a destination address, an exact
                amount, and a memo. Paste those into whatever XRP wallet you use and send.
                There is a QR code for phones.
              </li>
            </ol>
          </FAQItem>

          <FAQItem question="What intervals can I choose?">
            <P>
              <code className="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono">2 min</code>, hourly, daily or weekly. The two-minute option exists so a whole
              demonstration fits inside one short video. It is not there because anyone
              should deposit every two minutes.
            </P>
          </FAQItem>

          <FAQItem question="Why does the memo matter so much?">
            <P>
              The memo <strong style={{ color: "var(--l-text)" }}>is</strong> the instruction. Everything else in the payment is just a
              payment.
            </P>
            <P>
              Copy it exactly, character for character. A payment sent with the wrong memo,
              or no memo at all, is not a GiroLedger instruction. It will sit unclaimed until
              someone resolves it by hand.
            </P>
          </FAQItem>

          <FAQItem question="Why do I wait two to three minutes before anything happens?">
            <P>
              Because your payment has to be <em>proven</em> to Flare before anything is allowed to
              act on it, and that proof arrives in scheduled rounds rather than instantly.
              Measured across live runs, a round takes 60 to 140 seconds.
            </P>
            <P>
              This is the mechanism that makes the whole thing trustless, so the wait is the
              feature working, not the feature failing.
            </P>
          </FAQItem>

          <FAQItem question="How do I stop it?">
            <P>
              Press stop next to the rule. You get one more payment to send, <code className="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono">0.2 XRP</code>, which
              is fees only because a cancellation buys nothing. Same two to three minute
              wait, then the rule is dead.
            </P>
          </FAQItem>

          <FAQItem question="Can I withdraw my position through the app?">
            <P>Not yet, and this is a real gap rather than a hidden one.</P>
            <P>
              GiroLedger builds two instructions today: create a rule, and cancel a rule. It
              does not yet build a "withdraw" or "claim rewards" instruction. Your shares and
              any rewards sit in your own account and are yours, and the same memo mechanism
              could express a withdrawal, but that instruction has not been built.
            </P>
          </FAQItem>
        </Section>

        <Section title="Yield, rewards and who owns what">
          <FAQItem question="Do you collect my assets and pay me out later?" open={true}>
            <P>No. That describes a custodial pooled product, which is the opposite of this.</P>
            <ul className="list-disc pl-5 space-y-3 mt-2">
              <li>
                <strong style={{ color: "var(--l-text)" }}>Nothing is collected.</strong> In a single transaction, FXRP moves from your
                account, through the executor, into the vault, and shares come back to you.
                The executor holds a zero balance before and after. There is no pot.
              </li>
              <li>
                <strong style={{ color: "var(--l-text)" }}>No balances are recorded.</strong> The registry records the <em>rule</em>: how much, how
                often, how many runs remain, how much of the cap is spent. It is a schedule
                and a set of limits, not a ledger of who owns what. The vault already knows,
                and the answer is you.
              </li>
              <li>
                <strong style={{ color: "var(--l-text)" }}>Nothing is distributed by us.</strong> Firelight rewards whoever holds stXRP. You
                hold stXRP. We are not in that path and cannot be.
              </li>
            </ul>
          </FAQItem>

          <FAQItem question="What is the APY?">
            <P>There isn't one, and there deliberately isn't one anywhere in this app.</P>
            <P>
              GiroLedger does not generate yield. It automates getting you into something
              that does. Whatever a vault pays is the vault's business, and it varies by
              vault and by day. Putting a number on that here would be a claim we cannot
              defend.
            </P>
          </FAQItem>

          <FAQItem question="Then why does the testnet vault show no return at all?">
            <P>Two separate reasons, and both are true.</P>
            <ul className="list-disc pl-5 space-y-3 mt-2">
              <li>
                <strong style={{ color: "var(--l-text)" }}>It is a testnet vault.</strong> There are no real borrowers paying real interest
                behind it. It is a working replica so developers can test against it. Deposit
                into it by hand ten times without GiroLedger and you would still earn nothing.
              </li>
              <li>
                <strong style={{ color: "var(--l-text)" }}>Firelight does not pay through the share price.</strong> Depositing FXRP mints stXRP
                1:1 by design. Rewards arrive as separate tokens rather than by each share
                slowly becoming worth more. So the exchange rate staying flat is correct
                behaviour on mainnet too, not just here.
              </li>
            </ul>
          </FAQItem>

          <FAQItem question="What is Firelight, and how do its rewards work?">
            <P>
              Firelight is an XRP staking protocol that launched on Flare in December 2025.
              You deposit FXRP and receive stXRP, which you can then use elsewhere in the
              Flare ecosystem.
            </P>
            <P>
              Its rewards come from DeFi insurance cover: staked FXRP backs protection for
              other protocols against exploits and oracle risk, and those protocols pay fees
              for the cover. That reward phase was planned for early 2026 and depends on
              protocols actually adopting the model. In the meantime there is a boost
              programme paying rewards in rFLR, plus points for early depositors.
            </P>
            <div className="mt-4 p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--border)] italic text-[14px]">
              Check Firelight's own documentation for the current live status before
              relying on any of this. Do not quote a rate.
            </div>
          </FAQItem>

          <FAQItem question="If GiroLedger is not the yield, how do I ever receive rewards?">
            <P>
              Because you hold the position directly. You are the holder of record, so
              rewards reach you exactly as they reach anyone who deposited by hand.
            </P>
            <P>
              In <code className="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-sm font-mono">RuleExecutor.sol</code>, the deposit call names <em>your</em> account as the receiver:
            </P>
            <pre className="p-4 rounded-xl overflow-x-auto text-sm my-4 font-mono border" style={{ background: "var(--surface)", borderColor: "var(--l-line-strong)" }}>
              <code>uint256 shares = IERC4626(r.vault).deposit(amount, r.account);</code>
            </pre>
            <P>
              Shares are minted straight to your own account. They never touch our contract.
              Every reward mechanism keys off the holder address, and that address is yours.
            </P>
          </FAQItem>
        </Section>

        <Section title="Trust and safety">
          <FAQItem question="Two background services run this. Can they steal from me?">
            <P>No. They can delay you. They cannot touch your money or change your instruction.</P>
            <P>
              The memo is only 42 bytes, far too small to hold an instruction. So it holds a
              <strong style={{ color: "var(--l-text)" }}> fingerprint</strong> of one instead: a hash of the exact operation you signed for.
              The operator supplies the full operation; the chain hashes it and compares.
              Substitute anything at all and the hashes disagree and the transaction is
              rejected.
            </P>
            <P>
              The keeper is the same story. It only triggers rules that are already due, it
              holds no funds, and it has no permission you do not also have.
            </P>
          </FAQItem>

          <FAQItem question="What happens if you switch the services off?">
            <P>
              Your rules stop running. Your existing position, your shares and any rewards
              are completely untouched, because they were never ours to touch.
            </P>
            <P>
              That is the test that separates this from a custodian. A custodian failing
              looks very different.
            </P>
          </FAQItem>

          <FAQItem question="Can you spend more of my money than I agreed to?">
            <P>
              No. The instruction grants a <strong style={{ color: "var(--l-text)" }}>capped</strong> allowance. The cap is enforced by the
              contract, per rule, and the registry tracks how much of it has been spent.
            </P>
          </FAQItem>

          <FAQItem question="Is this safe to use with real money?">
            <P>
              No, and please don't. It is unaudited, it runs on Coston2 testnet, and the FXRP
              here is play money. There is an owner pause on executions, which is a
              reasonable safety valve for a prototype and would be timelocked or removed
              before real funds were ever involved.
            </P>
            <P>
              See the limitations section of the README for the full list.
            </P>
          </FAQItem>
        </Section>

      </main>
    </div>
  );
}
