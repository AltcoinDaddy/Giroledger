# Demo script

**Target: 90 seconds.** Screen recording with captions. No talking head, no slides, no logo animation.

Judges test demos. This is worth as much as a week of code, and it is the only part of the submission that is guaranteed to be watched.

---

## The timing problem, and how to solve it honestly

The obvious script is "send a payment, watch the rule appear." **You cannot film that in real time.** The FDC attestation round takes roughly 90 to 180 seconds to finalise, so there is a two to three minute hole between the XRPL payment and anything appearing on Flare. Nobody watches that.

Three ways to handle it. Only two are acceptable.

| Approach | Verdict |
|---|---|
| **Speed-ramp the wait** with an on-screen "waiting for FDC round, ~2 min" caption and a visible clock | ✅ **Use this.** Honest, and the caption turns a dead gap into an explanation of how the protocol works |
| **Two prepared accounts.** Account A sends live, then cut to account B whose rule was created earlier and is already executing | ✅ Acceptable if the cut is labelled on screen |
| Cut the wait silently so it looks instant | ❌ Misrepresents the product. A judge who tests it will find the gap and stop trusting everything else |

Measure the real round time during the spike (question Q5) and put the actual number in the caption.

---

## Shot list

### 0:00 to 0:12 · the claim

Show an XRP wallet holding only XRP. No Flare wallet, no browser extension, nothing connected.

> **Caption:** "This wallet holds XRP. No FLR. No EVM wallet. No bridge."

Then the GiroLedger page with no wallet connect button anywhere. Paste the XRPL address, hit Resolve, and the Flare account appears.

> **Caption:** "Its Flare account already exists. Derived from the XRPL address, not created by us."

**Why this shot first:** it is the only claim in the submission that sounds impossible. Land it before anything else.

### 0:12 to 0:28 · build the rule

Fill the form. Amount, frequency, number of runs. As the summary line updates, pause on it:

> "The most this rule can ever spend is 50 FXRP. That ceiling is enforced on-chain, not by this page."

Show the generated payment. One destination, one amount, one memo.

> **Caption:** "One payment. That is the entire setup."

### 0:28 to 0:40 · send it

Sign and submit from the XRP wallet. Show the XRPL explorer confirming.

Then the wait, speed-ramped, with a visible clock and the caption.

> **Caption:** "Waiting for the Flare Data Connector to attest the payment. ~2 minutes."

### 0:40 to 0:52 · it landed

Cut to the Coston2 explorer. `PersonalAccount` deployed, `RuleCreated` emitted. Show the transaction hash.

> **Caption:** "The account deployed itself on first use. The rule is live."

### 0:52 to 1:15 · it runs itself

The important shot. Use a short interval so executions are visible.

Show the keeper firing. Then the explorer: FXRP moving, `Deposited` emitted, vault shares arriving. **Show at least three executions**, and show the shares landing in the user's own account.

> **Caption:** "Nobody touched anything. Shares go to the user, never to the keeper."

Optionally show `/health` reporting executions, to make the point that this is a running system and not a script.

### 1:15 to 1:25 · stop it

Second XRPL payment. Rule goes inactive, allowance drops to zero.

> **Caption:** "Cancelled from the XRP side. The allowance is now zero."

*(If cancellation is unresolved by film day, cut this shot and say plainly in the README that early cancellation costs one small mint. Do not fake it.)*

### 1:25 to 1:30 · why Flare

One card, held long enough to read:

> Flare Smart Accounts · Flare Data Connector · FAssets · FTSOv2
> None of this works on another chain.

---

## Rules

1. **Real testnet, real transaction hashes, every shot.** No mock data, no localhost-only screens.
2. **Never two XRPL payments in flight at once.** Nonces collide, the second reverts, and the XRP sits at the Core Vault. This will happen on a re-shoot if you are not careful. Wait for confirmation between takes.
3. **Pre-flight the mint** with `spike:limits`. A demo-sized mint that trips a rate limit is silently delayed, not rejected, and your recording session dies waiting.
4. **Captions, not narration.** Judges often watch muted.
5. **Show explorer links.** They are the difference between a demo and a claim.
6. **No fabricated numbers.** No invented APY, no "10,000 users", no fake balances.

---

## Pre-flight checklist

Run these before you hit record. All three are cheap and all three have killed recordings.

```bash
pnpm verify-landing                    # every claim on the site is still true
pnpm --filter @giroledger/operator spike:limits    # mint will not be delayed
curl localhost:8080/health             # operator alive and watching
curl localhost:8081/health             # keeper alive, nothing quarantined
pnpm contracts:test                    # nothing regressed
```

`verify-landing` exists because the landing page keeps its evidence static, so
it loads fast and cannot be broken by an RPC hiccup mid-judging. Nothing tells
you when that evidence goes stale, so this does: it checks every transaction
hash and contract address against Coston2 and exits non-zero if any claim no
longer holds.

- [ ] XRPL testnet wallet funded, no pending payments
- [ ] Coston2 wallet has C2FLR for gas
- [ ] **Operator running.** Without it a payment sits at the Core Vault and no rule is ever created
- [ ] Contracts deployed and **verified** on the explorer, source visible
- [ ] Frontend deployed publicly, not localhost
- [ ] Browser zoomed so text is legible at 720p
- [ ] Devtools panel and any secrets hidden
- [ ] Rule interval short enough that three executions fit in the shot
- [ ] Screen recorder capturing at 1080p or better

---

## After

Upload unlisted, put the link in the DoraHacks submission and at the top of the README, and **check it plays logged out in a private window**. A dead demo link is the cheapest possible way to lose.
