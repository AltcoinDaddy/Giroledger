# Deploying

Three services, three Dockerfiles, one repository. Written for a host that
builds from a Dockerfile path and does not read `docker-compose.yml`.

| Service | Dockerfile | Public? | Persistent disk? |
|---|---|---|---|
| Site | `apps/web/Dockerfile` | **Yes** | No |
| Operator | `apps/operator/Dockerfile` | **Yes, over HTTPS** | **Yes** |
| Keeper | `apps/keeper/Dockerfile` | No | Optional |

`packages/shared` and `contracts` are not deployed. Shared is compiled into the
other three, and the contracts are already on Coston2.

---

## The one setting that breaks every first attempt

**Build context must be the repository root**, even though the Dockerfiles live
inside the app folders.

This is a pnpm workspace. Each app imports `@giroledger/shared` from
`packages/shared`, and pnpm will not install a workspace it cannot see. A build
scoped to `apps/operator` cannot see any of that and dies immediately.

On most hosts the two fields are separate:

- **Root directory** → leave blank, or `/`
- **Dockerfile path** → `apps/operator/Dockerfile`

If your host only offers one field and uses it for both, it cannot build this
repository as-is.

---

## Deploy in this order

The order matters because of one build-time dependency.

### 1. Operator, first

It has to exist before the site is built, because the site needs its URL baked
in. Once deployed, note the public HTTPS URL.

Attach a persistent disk mounted at `/app/apps/operator/data`. Without it, a
redeploy forgets every in-flight payment, and a user's XRP sits at the Core
Vault until someone completes it by hand.

### 2. Keeper, any time

No public URL needed, nothing calls it. Just make sure its Coston2 wallet has
gas. An unfunded keeper fails silently: rules simply stop firing.

### 3. Site, last

Set `VITE_OPERATOR_URL` to the operator's public HTTPS URL from step 1.

---

## Environment variables

### Operator

Required:

```
OPERATOR_PRIVATE_KEY
XRPL_WSS_URL
OPERATOR_XRPL_ADDRESS
RULE_REGISTRY_ADDRESS
RULE_EXECUTOR_ADDRESS
FXRP_ADDRESS
FDC_VERIFIER_URL
FDC_VERIFIER_API_KEY
FDC_DA_LAYER_URL
FDC_DA_LAYER_API_KEY
FIRST_VOTING_ROUND_START_TS
VOTING_EPOCH_DURATION_SECONDS
```

Has a sensible default, override only if you need to:

```
COSTON2_RPC_URL   NODE_ENV   LOG_LEVEL   STATE_DIR   OPERATOR_HTTP_PORT
```

`STATE_DIR` already defaults to the volume path in the image. If your host
mounts disks somewhere else, point `STATE_DIR` at that path instead.

### Keeper

Required:

```
KEEPER_PRIVATE_KEY
RULE_REGISTRY_ADDRESS
RULE_EXECUTOR_ADDRESS
```

Optional:

```
COSTON2_RPC_URL   NODE_ENV   LOG_LEVEL   HEALTH_PORT
POLL_INTERVAL_MS   MAX_BATCH_SIZE
GAS_PER_RULE   GAS_BATCH_OVERHEAD   MAX_TX_GAS   MAX_NOOP_STRIKES
```

### Site

These are **build arguments, not runtime variables.** Vite compiles them into
the bundle, so setting them as environment variables on your host does nothing
at all. Most platforms let you declare build args next to env vars; make sure
you are using the right box.

```
VITE_RULE_REGISTRY_ADDRESS
VITE_RULE_EXECUTOR_ADDRESS
VITE_VAULT_ADDRESS
VITE_OPERATOR_URL      ← the operator's public HTTPS URL
VITE_SITE_URL          ← this site's own public URL
```

Changing any of these needs a **rebuild**, not a restart.

---

## Ports

All three read `PORT` if the host injects one, which most do, and fall back to
their own defaults otherwise: 3000 for the site, 8080 for the operator, 8081
for the keeper.

The operator deliberately uses `OPERATOR_HTTP_PORT` rather than `HEALTH_PORT`.
Both services once shared a single `.env`, the later line won, and they
collided on one port with one of them failing to bind.

---

## Two failure modes to expect

**Mixed content.** An HTTPS site cannot post to a plain-HTTP operator. The
browser blocks the request, the instruction is never registered, and the
payment strands with no visible error on the page. Both must be HTTPS.

**Nonce collisions.** Your operator and keeper currently share one private key,
so both send Coston2 transactions from the same address while each tracks its
own nonce. Under load, one gets a collision and reverts. Give the keeper its
own `KEEPER_PRIVATE_KEY` and fund that wallet separately.

---

## Check it worked

```bash
curl -s https://YOUR-OPERATOR-URL/health
curl -s https://YOUR-KEEPER-URL/health      # only if you routed it
curl -sI https://YOUR-SITE-URL
```

The operator is only doing its job if `watching` is a real XRPL address. If it
is `null`, it is not subscribed and nothing will ever complete.

Then, from the deployed site, open the browser console and create a rule. A
successful `POST /instructions` returning `202` means the site and operator can
actually talk to each other, which is the one thing local testing cannot prove.
