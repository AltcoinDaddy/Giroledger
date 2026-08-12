# syntax=docker/dockerfile:1
#
# GiroLedger, the operator.
#
#   ⚠️  BUILD CONTEXT MUST BE THE REPOSITORY ROOT, NOT THIS FOLDER.
#
#       docker build -f apps/operator/Dockerfile -t giroledger-operator .
#
# This is a pnpm workspace. The operator imports `@giroledger/shared`, which
# lives at packages/shared, so a build that can only see apps/operator cannot
# resolve it. On your host, set the Dockerfile path to
# `apps/operator/Dockerfile` and leave the root directory as the repository
# root.
#
# ── This service must be publicly reachable over HTTPS ──────────────────────
#
# The 42-byte memo carries only keccak256(userOperation), never the operation
# itself, so the browser posts the instruction body to POST /instructions
# before the user pays. If this service is not reachable from the user's
# browser, the payment arrives with nothing to match it against and the XRP
# sits at the Core Vault until someone completes it by hand.
#
# ── It also needs a persistent disk ─────────────────────────────────────────
#
# Mount one at STATE_DIR. Without it, a redeploy forgets every in-flight
# payment, with the same consequence as above.

# ---------------------------------------------------------------- base ------
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app
ENV CI=true

# --------------------------------------------------------------- deps -------
# Every workspace package.json must be listed: pnpm refuses to install a
# workspace it cannot see, even one this service does not import.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json           apps/web/
COPY apps/operator/package.json      apps/operator/
COPY apps/keeper/package.json        apps/keeper/
COPY packages/shared/package.json    packages/shared/
COPY contracts/package.json          contracts/
# No `--mount=type=cache` here on purpose. It needs BuildKit, and hosted
# builders often still run the legacy builder, where that flag is a hard error
# rather than a warning. A cache mount only makes rebuilds faster; failing to
# build at all is worse than building slowly. The root Dockerfile, which only
# ever runs locally under BuildKit, keeps the cache.
RUN pnpm install --frozen-lockfile

# ------------------------------------------------------------- runtime ------
# The service runs its TypeScript directly through tsx. Its `build` script is
# `tsc --noEmit`, a type check that emits nothing, so there is no compiled
# output to copy and pretending otherwise would produce an image that cannot
# run.
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules                      ./node_modules
COPY --from=deps /app/apps/operator/node_modules        ./apps/operator/node_modules
COPY --from=deps /app/packages/shared/node_modules      ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/operator ./apps/operator

# Pending instructions and held payments live here. Point a persistent disk at
# this path on your host.
ENV STATE_DIR=/app/apps/operator/data
VOLUME ["/app/apps/operator/data"]

EXPOSE 8080

WORKDIR /app/apps/operator

# Start tsx DIRECTLY, not through pnpm. Two reasons, both of which cost a
# failed deployment before they were found:
#
#   1. `pnpm` in the runtime stage makes corepack fetch the pnpm tarball from
#      npm on every container start. That needs network before the app can
#      even begin, and it blows past a 20-second startup health probe.
#   2. pnpm 11 verifies the lockfile before running a command, which resolves
#      the whole workspace at boot. Same delay, same result.
#
# The package's own `start` script is no good here either: it passes
# --env-file=../../.env, which does not exist in an image and must not.
# Configuration arrives from the host environment instead.
#
# Port: an explicitly set OPERATOR_HTTP_PORT wins, then whatever the host
# injects as PORT, then the default. Hosts disagree about which they set, and
# binding the wrong one looks exactly like a crashed app.
CMD ["sh", "-c", "exec ./node_modules/.bin/tsx src/index.ts"]
