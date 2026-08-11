# syntax=docker/dockerfile:1
#
# GiroLedger, the keeper.
#
#   ⚠️  BUILD CONTEXT MUST BE THE REPOSITORY ROOT, NOT THIS FOLDER.
#
#       docker build -f apps/keeper/Dockerfile -t giroledger-keeper .
#
# This is a pnpm workspace. The keeper imports `@giroledger/shared`, which
# lives at packages/shared, so a build that can only see apps/keeper cannot
# resolve it. On your host, set the Dockerfile path to
# `apps/keeper/Dockerfile` and leave the root directory as the repository root.
#
# ── This service needs no public URL ────────────────────────────────────────
#
# Nothing calls it. It polls for due rules and submits executions. It exposes a
# health endpoint for your own monitoring, and that is the only reason to route
# traffic to it at all.
#
# ── What it does need is gas ────────────────────────────────────────────────
#
# It pays for every execution. An unfunded keeper is silent: rules simply stop
# firing. Watch the Coston2 balance during judging week.

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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ------------------------------------------------------------- runtime ------
# Runs TypeScript directly through tsx. The `build` script is `tsc --noEmit`,
# a type check that emits nothing, so there is no compiled output to copy.
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules                    ./node_modules
COPY --from=deps /app/apps/keeper/node_modules        ./apps/keeper/node_modules
COPY --from=deps /app/packages/shared/node_modules    ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/keeper ./apps/keeper

ENV STATE_DIR=/app/apps/keeper/data
VOLUME ["/app/apps/keeper/data"]

ENV HEALTH_PORT=8081
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${HEALTH_PORT:-8081}/health" >/dev/null || exit 1

WORKDIR /app/apps/keeper

# The package's own `start` script passes --env-file=../../.env, which does not
# exist in an image and must not: secrets arrive from the host at run time.
CMD ["sh", "-c", "export HEALTH_PORT=\"${PORT:-${HEALTH_PORT:-8081}}\"; exec pnpm exec tsx src/index.ts"]
