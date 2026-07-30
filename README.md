<div align="center">

# GiroLedger

### Standing orders for XRP. One payment, then it runs itself.

**A recurring-order engine that lets XRP Ledger users run automated strategies on Flare without ever holding FLR, creating an EVM wallet, or touching a bridge.**

[![Network](https://img.shields.io/badge/network-Flare%20Coston2-red)](https://coston2-explorer.flare.network)
[![Chain ID](https://img.shields.io/badge/chain%20id-114-lightgrey)](https://dev.flare.network/network/overview)
[![XRPL](https://img.shields.io/badge/XRPL-testnet-blue)](https://xrpl.org)
[![Solidity](https://img.shields.io/badge/solidity-0.8.27-black)](https://soliditylang.org)
[![Status](https://img.shields.io/badge/status-in%20development-orange)](#project-status)

**Built for [Flare Summer Signal](https://dorahacks.io/hackathon/flaresummersignal/detail)** · Track: interoperable asset products

[Demo video](#demo) · [How it works](#how-it-works) · [Why this needs Flare](#why-this-requires-flare) · [Quickstart](#quickstart) · [Limitations](#security-and-limitations)

</div>

---

## TL;DR

An XRP holder sends **one** payment from their ordinary XRP wallet. That payment creates a persistent rule on Flare which then executes on its own, over and over, until they cancel it with a second payment.

No FLR. No EVM wallet. No seed phrase on a second chain. No bridge UI.

## Status, honestly

Judges get lied to a lot by hackathon READMEs. Here is the real state, updated as things land.

| Component | State |
|---|---|
| Rule engine (`RuleRegistry`, `RuleExecutor`) | ✅ **Live on Coston2. 34 Solidity tests passing**, incl. fuzzing, a hostile-vault reentrancy test, and fork tests against live Coston2 |
| Create a rule from one XRPL payment | ✅ **Done live, four times.** 90 to 157 seconds end to end |
| Rules executing unattended | ✅ **Done live.** A keeper ran a 10-run rule with nobody watching |
| Cancel a rule from a second XRPL payment | ✅ **Done live.** 0.2 XRP, 175 seconds, 8 of 10 runs left unused |
| Smart Accounts memo encoding | ✅ **Locked.** Our encoder reproduces the exact `userOpHash` from a live Coston2 execution, asserted by a golden test |
| Web UI | Built, runs locally, reads live chain state and generates the real payment memo, including the cancel flow. **Not yet deployed publicly** |
| Web-generated payment, end to end | ✅ **Proven 28 July.** A payment priced and encoded by the app, sent from a wallet, completed by the operator: [`0xc02a661e…7fc4e`](https://coston2-explorer.flare.network/tx/0xc02a661ef03ce13c976ac7698e234c7a722e8663f234755cdf625abd50e7fc4e) |
| Operator running as a watcher | ✅ **Proven 28 July.** Watches the direct-minting address, matches an arriving memo to an instruction handed over in advance, and completes it unattended in 2m52s: [`0x8ef9a209…a5f72`](https://coston2-explorer.flare.network/tx/0x8ef9a209056ecca4d2d23101d15b75a3b1570e2750a0f17e96e9792f78da5f72) |
| Demo video | **Not recorded** |
| Contract source verification | ✅ **Verified on Blockscout and Sourcify** |
| Unattended 24-hour keeper run | **Not done.** Longest observed run is ~35 minutes |
| Price-triggered rules (FTSOv2) | **Not implemented.** `createRule` rejects `Trigger.PRICE` rather than half-supporting it |

61 TypeScript tests and 34 Solidity tests pass. The unfinished items above are unfinished, not "coming soon".

**Four things we got wrong and corrected, recorded because they shaped the design:**

1. **Flare Confidential Compute is not publicly available**, and Protocol Managed Wallets is marked in development. The original plan was built on both. It was scrapped in week one rather than faked.
2. **Custom instructions ride on a direct mint.** `handleMintedFAssets` reverts with `OnlyAssetManager` for any other caller, so a memo instruction is dispatched as a side effect of FXRP being minted, not as a free-standing call. This is why creating a rule funds and configures it in one payment.
3. **The operator is not optional, and we assumed it was.** The README used to say GiroLedger ran no operator of its own, on the reasoning that Flare publishes public operator wallets. Tested properly on 28 July by sending a payment and then deliberately doing nothing: no rule appeared. A direct-minting payment nobody follows up on simply sits at the Core Vault. The attestation has to be requested and submitted, and until that test our own script had always quietly done it while pretending to be the user. The stranded payment was then recovered by rebuilding the instruction from the same nonce, which is worth knowing in its own right: [`0xc02a661e…7fc4e`](https://coston2-explorer.flare.network/tx/0xc02a661ef03ce13c976ac7698e234c7a722e8663f234755cdf625abd50e7fc4e).
4. **`try/catch` blinds `eth_estimateGas`.** `executeBatch` catches individual failures, so the outer call succeeds even when an inner call runs out of gas. The estimator returned 316,693 for a call needing 316,021, and under EIP-150 the inner call received only ~311k of it. Sixty consecutive batches reported success having executed nothing. Fixed with a `gasleft()` floor that gives the estimator a revert to find, a revert selector on `ExecutionSkipped`, and a keeper that reads `succeeded` rather than the receipt status.

---

## The problem

[Flare Smart Accounts](https://dev.flare.network/smart-accounts/overview) is a genuinely novel primitive: every XRPL address gets a `CREATE2`-derived account on Flare that it controls through ordinary XRPL `Payment` transactions. An XRP holder can trigger Flare smart contract calls without owning FLR or an EVM wallet.

But every instruction today is **one shot**. Send a payment, one thing happens, done.

That means an XRPL-native user cannot express any of the things that actually matter in DeFi:

- "Put 10 XRP into this vault every week."
- "Deposit when XRP drops below $2."
- "Keep doing this until I tell you to stop."

To do any of that today they have to acquire FLR for gas, create and secure an EVM wallet, learn a bridge, and come back manually every single time. That is the entire reason XRP's enormous holder base has stayed out of on-chain strategies.

## What GiroLedger does

GiroLedger makes the single payment **persistent**.

| | Before | With GiroLedger |
|---|---|---|
| Set up a recurring deposit | Bridge, fund an EVM wallet with FLR, approve, deposit, repeat manually | One XRPL payment |
| Assets needed | XRP **and** FLR for gas | XRP only |
| Wallets needed | XRP wallet **and** EVM wallet | XRP wallet only |
| Ongoing effort | Manual, every single time | None |
| Cancel | Revoke approvals from the EVM wallet | One more XRPL payment |

One XRPL payment carries an instruction that does two things atomically: it grants a **capped** allowance to the executor contract, and it registers the rule. A permissionless keeper then executes that rule whenever it is due. Vault shares are always minted back to the user's own account.

---

## Why this requires Flare

**This project cannot be ported to another chain.** That is the point. Every layer depends on a primitive that only Flare has.

| What we need | Flare primitive | Where we use it | Why nothing else works |
|---|---|---|---|
| Let an XRP holder call a contract with no EVM wallet and no gas token | **[Flare Smart Accounts](https://dev.flare.network/smart-accounts/overview)** | [`packages/shared/src/smartAccount.ts`](packages/shared/src/smartAccount.ts) encodes the `0xFE` memo; [`apps/web/src/routes/app.tsx`](apps/web/src/routes/app.tsx) resolves the account | The only account-abstraction system where authorisation comes from an XRPL payment signature. `PersonalAccount` addresses are `CREATE2`-derived from the XRPL address. |
| Prove an XRPL payment and its memo happened, trustlessly | **[FDC `XRPPayment` attestation](https://dev.flare.network/fdc/attestation-types/xrp-payment)** | [`apps/operator/src/fdc.ts`](apps/operator/src/fdc.ts) requests and fetches the proof; [`apps/operator/src/index.ts`](apps/operator/src/index.ts) submits it | Enshrined into the [Flare Systems Protocol](https://dev.flare.network/network/fsp), so it inherits the network's full economic security. Carries memo data and destination tag natively. Not a third-party bridge oracle. |
| A real, redeemable XRP asset to deploy | **[FXRP / FAssets](https://dev.flare.network/fxrp/overview)** | [`packages/shared/src/directMinting.ts`](packages/shared/src/directMinting.ts) prices the payment; the instruction rides on `executeDirectMintingWithData` | Trustless over-collateralised representation of XRP, not a custodial wrapper. |
| Somewhere for the assets to earn | **[Firelight](https://dev.flare.network/fxrp/firelight) / [Upshift](https://dev.flare.network/fxrp/upshift)** | [`contracts/src/RuleExecutor.sol`](contracts/src/RuleExecutor.sol) deposits via ERC-4626, shares minted to the user | ERC-4626 vaults native to the FXRP ecosystem. |
| Price-conditional triggers | **[FTSOv2](https://dev.flare.network/ftso/overview)** | **Not implemented.** `RuleRegistry.createRule` rejects `Trigger.PRICE` rather than half-supporting it | Enshrined block-latency feeds updating roughly every 1.8s, with no external oracle dependency or subscription. |

Remove Flare and there is no product. There is no other chain where an XRPL payment signature is sufficient authorisation to move an on-chain position.

---

## Demo

Every transaction below is real, on Flare Coston2, and can be opened right now.

| | |
|---|---|
| 📹 **Video (90s)** | `TODO(P-04)` — not yet recorded |
| 🌐 **Live app** | `TODO(W-08)` — runs locally, not yet deployed publicly |
| 🔍 **A rule created by one XRPL payment** | [`0x332cb114…c44770`](https://coston2-explorer.flare.network/tx/0x332cb1149a1dc09b2abde2cb3b26f80b1134f9db1908d2e1074057c348c44770) |
| ⚙️ **That rule executing itself, unattended** | [`0x1c5d1a15…e9d3c0`](https://coston2-explorer.flare.network/tx/0x1c5d1a15c287a40c5cbd7923a592d1e7124c734027f19ba6293b89d0eee9d3c0) |
| 🛑 **Stopped by a second XRPL payment** | [`0xdf26dfa5…6ab28b`](https://coston2-explorer.flare.network/tx/0xdf26dfa5feb92473529773632fd1daca4ef2b564ad12772c15c6b26b376ab28b) |

The `PersonalAccount` those rules belong to is
[`0xe29c2E18…C8720dab`](https://coston2-explorer.flare.network/address/0xe29c2E182bFB46977BA574f80005ac28C8720dab).
It was never deployed by us. It is derived from the XRPL address
`rn5Bu7Uce1dUS83NoAHoP3GBtniShkNtaL` and deployed itself on first use.

**What the video will show, in order:** an XRP-only wallet with no Flare presence → one XRPL payment → the `PersonalAccount` appearing on the Coston2 explorer → the keeper firing three times unattended → FXRP arriving in the vault with shares owned by the user → a second payment cancelling the rule.

---

## How it works

```
 ┌──────────────────┐
 │  XRP wallet      │   User holds only XRP. No FLR. No EVM key.
 │  (XRPL testnet)  │
 └────────┬─────────┘
          │  ① ONE Payment tx, memo carries the encoded instruction
          ▼
 ┌──────────────────┐
 │  Operator        │   Watches the XRPL address (xrpl.js)
 └────────┬─────────┘
          │  ② requests FDC XRPPayment attestation
          ▼
 ┌──────────────────────────────┐
 │  Flare Data Connector (FDC)  │   Enshrined. Attests the payment + memo.
 └────────┬─────────────────────┘
          │  ③ proof submitted on-chain
          ▼
 ┌──────────────────────────────┐
 │  MasterAccountController     │   Resolves / CREATE2-deploys the account
 └────────┬─────────────────────┘
          ▼
 ┌──────────────────┐        ④ batch: approve(cap) + createRule(params)
 │  PersonalAccount │◄──────────────────────────────┐
 │  (holds FXRP)    │                               │
 └────────┬─────────┘                               │
          │                                    ┌────┴──────────┐
          │  ⑥ transferFrom (capped)           │ RuleRegistry  │
          ▼                                    └────┬──────────┘
 ┌──────────────────┐   ⑤ polls dueRules()          │
 │  RuleExecutor    │◄───────── Keeper ─────────────┘
 └────────┬─────────┘              ▲
          │                        │ FTSOv2 XRP/USD (price trigger)
          │  ⑦ deposit(amount, receiver = PersonalAccount)
          ▼
 ┌──────────────────┐
 │  ERC-4626 vault  │   Shares owned by the USER, never the executor.
 └──────────────────┘
```

### The key design decision

The allowance is granted **once, at rule creation**, inside the same user operation that registers the rule. The executor therefore never calls back into the `PersonalAccount` at execution time. Execution is a plain `transferFrom` bounded by an on-chain cap.

This matters for three reasons:

1. **Safety.** The user's authorisation ceiling is set by the user, in the payment they signed, and enforced on-chain. Nothing downstream can exceed it.
2. **Simplicity.** It removes an entire class of cross-contract authorisation problems.
3. **Trust minimisation.** The keeper is **liveness-critical but not safety-critical**. If it disappears, rules stop firing. It cannot steal, redirect, or over-spend. `execute()` is permissionless, so anyone can run one.

---

## Quickstart

Reproduces a live rule on Coston2 in roughly five minutes.

**Prerequisites:** Node 22+, [pnpm](https://pnpm.io/installation) 11+, an XRPL testnet account. No other toolchain to install.

```bash
git clone https://github.com/AltcoinDaddy/Giroledger && cd Giroledger
pnpm install
cp .env.example .env          # add your Coston2 key and XRPL testnet seed
```

Fund your Coston2 address at the [Coston2 faucet](https://faucet.flare.network/coston2). It dispenses C2FLR for gas **and FXRP**, so no FAssets minting is required to try this.

```bash
# 1. contracts
pnpm contracts:build
pnpm contracts:test           # Solidity tests, incl. fuzzing
pnpm contracts:test:fork      # same tests against real Coston2 state
pnpm contracts:deploy         # writes addresses, paste them into .env

# 2. everything else, in parallel
pnpm dev                      # web on :3000, operator, keeper

# or individually
pnpm dev:web
pnpm dev:operator
pnpm dev:keeper
```

Open http://localhost:3000, paste an XRPL testnet address, build a rule, and send the single XRPL payment it generates. Watch the rule appear and then execute.

**Both services must be running.** The operator turns your payment into a rule; without it the payment sits at the Core Vault and nothing happens. The keeper then executes due rules. Check them:

```bash
curl localhost:8080/health    # operator: watching, completed, heldPayments
curl localhost:8081/health    # keeper: pendingDue, executed, quarantined
```

**If the app fails to start with a routing error**, generate the route tree. It is derived from `apps/web/src/routes/` and therefore not committed:

```bash
pnpm --filter @giroledger/web generate-routes
```

---

## Deployed contracts (Coston2)

**Ours, live on Coston2 (chain 114), deployed 28 July 2026:**

**Source verified on both Blockscout and Sourcify.** Read the code on the explorer, not just here.

| Contract | Address | Source |
|---|---|---|
| `RuleRegistry` | [`0xd430b9E2…57ce6`](https://coston2-explorer.flare.network/address/0xd430b9E2756b26F616C0b1C88b0707898D057ce6) | [Blockscout](https://coston2-explorer.flare.network/address/0xd430b9E2756b26F616C0b1C88b0707898D057ce6#code) · [Sourcify](https://sourcify.dev/server/repo-ui/114/0xd430b9E2756b26F616C0b1C88b0707898D057ce6) |
| `RuleExecutor` | [`0x10E74799…5A546`](https://coston2-explorer.flare.network/address/0x10E74799fde0c5f26d14EA83b6e837cA0115A546) | [Blockscout](https://coston2-explorer.flare.network/address/0x10E74799fde0c5f26d14EA83b6e837cA0115A546#code) · [Sourcify](https://sourcify.dev/server/repo-ui/114/0x10E74799fde0c5f26d14EA83b6e837cA0115A546) |

Re-verify with `pnpm contracts:verify`. That script rebuilds with the `production` profile first, deliberately: `pnpm contracts:test` recompiles with the unoptimized `default` profile and overwrites the artifacts, after which verification compares optimized on-chain bytecode against an unoptimized local build and fails with a confusing bytecode mismatch.

An earlier deployment (`0x20E07d6c…`, `0x0F744c09…`) is still on chain and still holds five real executions, but it lacks the `GAS_PER_RULE` floor described under [Known limitations](#known-limitations) and is superseded. Rules created against it cannot be executed by the current registry, because a rule's FXRP allowance names a specific executor.

**Flare infrastructure, confirmed live by a chain read on 28 July 2026:**

| What | Address |
|---|---|
| `MasterAccountController` | [`0x4349…D37c`](https://coston2-explorer.flare.network/address/0x434936d47503353f06750Db1A444DBDC5F0AD37c) |
| `AssetManagerFXRP` | [`0xc1Ca88b9…bDFA`](https://coston2-explorer.flare.network/address/0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA) |
| FXRP (`FTestXRP`, 6 decimals) | [`0x0b6A…3dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |
| Firelight vault (id 1), allowlisted | [`0xC90D6847…0361`](https://coston2-explorer.flare.network/address/0xC90D6847747b85d1fa2E07859869fb9fB72c0361) |
| Operator XRPL wallet (Flare's, public) | `rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq` |

Vault addresses are read from `MasterAccountController.getVaults()` at runtime, not hardcoded. That list changed under us during the build, which is why `pnpm --filter @giroledger/operator vaults` exists: it prints Flare's list alongside our registry's allowlist and flags any disagreement.

Flare system contracts are resolved at runtime through the [`FlareContractRegistry`](https://dev.flare.network/network/guides/flare-contracts-registry) rather than hardcoded, because addresses differ per network and do change.

---

## Repository structure

pnpm workspace monorepo.

```
giroledger/
├── apps/
│   ├── web/            # TanStack Start. No wallet connection needed to view.
│   ├── operator/       # XRPL watcher → FDC attestation → MasterAccountController
│   └── keeper/         # polls due rules, submits executions
├── packages/
│   └── shared/         # types, chain config, ABIs, instruction codec
├── contracts/          # Hardhat 3 + viem
│   ├── src/            # *.sol contracts and *.t.sol Solidity tests
│   └── ignition/       # deployment modules
└── docs/
```

`packages/shared` is the single source of truth for the rule types, the contract ABIs and the instruction codec. The three apps import it rather than each keeping their own copy, so an encoding change cannot silently desync the operator from the frontend.

---

## Testing

Hardhat 3 with Solidity tests (`forge-std` cheatcodes and native fuzzing), so there is no separate toolchain to install.

```bash
pnpm contracts:test        # 39 passing on the local EDR chain
pnpm contracts:test:fork   # forked Coston2: real FXRP, real vaults, not mocks
```

Fork testing is the one that earns its place. A hand-written mock vault does exactly what you expect it to; the real one has its own decimals, share rounding and minimum deposit. The fork suite skips with a printed message until `FXRP_ADDRESS` and `VAULT_ADDRESS` are set, rather than passing vacuously.

Contract tests assert six execution invariants:

| ID | Invariant | How it's proven |
|---|---|---|
| I1 | `totalSpent` never exceeds `totalSpendCap` | Exhaustive run plus a 256-case fuzz; separately, the ERC-20 allowance is an independent ceiling |
| I2 | Vault shares always mint to the user's account | Asserted against executor and keeper balances |
| I3 | A rule cannot execute twice inside its interval | Including the exact boundary second |
| I4 | Inactive, cancelled, exhausted or unknown rules revert | Four separate cases |
| I5 | The executor holds zero token balance between transactions | Enforced in the contract, not just asserted in tests |
| I6 | Reentrancy cannot double spend | A hostile vault actually attempts reentry mid-deposit |

I6 is worth a note. It's stopped twice over: by the `ReentrancyGuard`, and because `markExecuted` advances `nextRunAt` before any external call, so a reentrant path fails its own due check. Defence in depth rather than one guard and hope.

### Acceptance criteria

The project is complete when all eight pass. **Six of eight pass today.**

| ID | Criterion | Status |
|---|---|---|
| A1 | An XRPL testnet payment executes an arbitrary call on Coston2 via a Smart Account | ✅ [`0xeda8fab5…ab89`](https://coston2-explorer.flare.network/tx/0xeda8fab5dd91b353cafa63ffb8f8173f9dbbf55584b1d584e77bfe10b6a5ab89) |
| A2 | One XRPL payment creates a rule, with `RuleCreated` visible on the Coston2 explorer | ✅ [`0x332cb114…770`](https://coston2-explorer.flare.network/tx/0x332cb1149a1dc09b2abde2cb3b26f80b1134f9db1908d2e1074057c348c44770) |
| A3 | The keeper executes a due rule with no user action, and FXRP moves into the vault | ✅ [`0x1c5d1a15…3c0`](https://coston2-explorer.flare.network/tx/0x1c5d1a15c287a40c5cbd7923a592d1e7124c734027f19ba6293b89d0eee9d3c0) |
| A4 | Vault shares are held by the `PersonalAccount`, verifiable via `balanceOf` on the explorer | ✅ 3,000,000 shares for 3 FXRP, 1:1 |
| A5 | A rule executes at least three times unattended across a 24 hour run | ❌ Longest observed run ~35 minutes |
| A6 | Exceeding `totalSpendCap` reverts, covered by a unit test | ✅ `test_I1_totalSpentNeverExceedsCap` plus a fuzz test |
| A7 | A second XRPL payment cancels the rule and reduces the allowance to what the account's remaining active rules need | ✅ [`0xdf26dfa5…28b`](https://coston2-explorer.flare.network/tx/0xdf26dfa5feb92473529773632fd1daca4ef2b564ad12772c15c6b26b376ab28b) |
| A8 | A fresh clone plus this quickstart reproduces A2 and A3 on a clean machine | ❌ Never tried on a second machine |

---

## Stopping a rule

The obvious question about a standing order, answered directly.

**You send one more payment.** 0.2 XRP, carrying a memo that says cancel instead of create. Same mechanism as starting one, so there is nothing new to learn and still no wallet to connect. The memo carries two calls: `cancelRule(ruleId)`, then an `approve` that lowers the FXRP allowance.

Proven on Coston2, not asserted:
[`0xdf26dfa5…6ab28b`](https://coston2-explorer.flare.network/tx/0xdf26dfa5feb92473529773632fd1daca4ef2b564ad12772c15c6b26b376ab28b)
stopped a rule with 8 of 10 runs unused. Cost 0.2 XRP, took 175 seconds, and left the rule inactive with the allowance reduced to what the account's other active rules still needed (zero, in that case, because there were none).

**Why cancelling costs less than creating.** A create payment also mints the FXRP the rule will spend. A cancel mints nothing, so the cost is fees only: the direct-minting minimum fee plus the executor fee.

**The honest limitation: it is not instant.** Cancelling needs an FDC attestation round, so it takes roughly two to three minutes. Measured range on Coston2: 60 to 140 seconds for the round, 90 to 175 seconds end to end.

That latency is a convenience limitation, not a safety one, and the distinction is the point. During those minutes the rule can still only spend what the user already approved, bounded by `totalSpendCap` in the ERC-20 allowance and by `maxRuns` in the registry. The worst case is one further scheduled run of an amount the user had already authorised. There is no state in which waiting for a cancel exposes funds beyond the original ceiling.

**A rule that finishes normally needs no cancelling.** `markExecuted` deactivates it on its final run and the allowance is consumed to exactly zero, so no residual approval is left behind.

**One allowance, many rules.** Every rule on an account shares a single ERC-20 approval. Creating a rule therefore approves the new cap *plus* what existing active rules still need, and cancelling drops the allowance to what the *remaining* rules need rather than to zero. Getting this wrong is easy and we got it wrong first: an early version approved each rule's cap absolutely, so a second rule silently starved the first. Caught on Coston2 when a live rule sat `DUE` with 8 runs remaining and no allowance to draw them. The fix is `sumActiveCommitment` in `packages/shared/src/memo.ts`, with regression tests in both directions.

That bug could never have overspent. `RuleRegistry.markExecuted` enforces each rule's own cap independently of the allowance, so the failure was a stuck rule rather than a drained one.

---

## Security and limitations

Stated plainly, because a hackathon prototype that pretends to be production software is worse than one that does not.

**What is enforced on-chain**

- Spend caps, in the contract, not in the UI
- Vault allowlist, so an arbitrary target cannot be passed in
- ERC-4626 shares always minted to the rule's owner
- Reentrancy guards on every path that moves tokens
- Paginated reads, no unbounded loops
- XRPL transaction ID replay protection

**Known limitations, not fixed**

| Limitation | Impact | Why it is acceptable here |
|---|---|---|
| Single keeper instance | Liveness only. Rules stop firing if it dies. | `execute()` is permissionless, so anyone can run a keeper. No funds at risk. |
| `pause()` is owner-controlled | Centralisation | Testnet safety valve. Would be timelocked or removed for production. |
| Not audited | Do not use with real value | Testnet only, no mainnet deployment exists |
| Price trigger reads a single feed, no TWAP | A brief feed anomaly could fire a rule early | Bounded by the interval cooldown and the spend cap. Mitigated, not eliminated. |
| Operator is run by us, and is **required** | Liveness and censorship | Tested 28 July: a payment nobody follows up on sits at the Core Vault untouched. Flare's public operator wallets do **not** pick up direct-minting payments, so someone must request the attestation and submit it. The operator still cannot forge an instruction: authorisation comes from the XRPL signature and the FDC proof attests the payment independently. If it stops, rules stop being created and nothing else happens. Funds are recoverable: the instruction is deterministic, so a stranded payment can be completed later from the same nonce. |
| Cancelling takes 2 to 3 minutes | Cannot stop a rule instantly | Bounded by the allowance and `maxRuns`, so the worst case is one already-authorised run. See [Stopping a rule](#stopping-a-rule). |
| `executeBatch` caps each rule at `GAS_PER_RULE` (600k) | A vault whose deposit exceeds that would be skipped | Measured: Firelight uses ~470k. A skipped rule emits `ExecutionSkipped` with the revert selector and the keeper quarantines it after three attempts, so it fails loudly. The keeper also calls the uncapped `execute()` when only one rule is due. |
| One XRPL payment in flight per account | A second payment built from the same nonce reverts and its XRP is stranded at the Core Vault | The UI states the nonce it is bound to and warns explicitly. Recoverable via the `0xE0` skip-memo flow. |

---

## Roadmap

Beyond the hackathon, in priority order:

1. **Confidential rule parameters.** Keep the price threshold inside a [Flare Compute Extension](https://dev.flare.network/fcc/overview) so it cannot be read on-chain and front-run. Blocked today: FCC is documented as not yet publicly available, and Protocol Managed Wallets is marked in development.
2. **Multi-asset.** FBTC and FDOGE as they arrive in FAssets.
3. **Decentralised keeper set** with execution rewards.
4. **More rule types.** Rebalancing, laddered exits, conditional redemption back to native XRP.

---

## Acknowledgements

Built on [Flare](https://flare.network) using Smart Accounts, the Flare Data Connector, FAssets, and FTSOv2. Documentation at [dev.flare.network](https://dev.flare.network).

## Licence

MIT. See [`LICENSE`](./LICENSE).
