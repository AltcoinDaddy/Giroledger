# syntax=docker/dockerfile:1
#
# GiroLedger, the site.
#
#   ⚠️  BUILD CONTEXT MUST BE THE REPOSITORY ROOT, NOT THIS FOLDER.
#
#       docker build -f apps/web/Dockerfile -t giroledger-web .
#
# This is a pnpm workspace. The site imports `@giroledger/shared`, which lives
# at packages/shared, so a build that can only see apps/web cannot resolve it.
# On your host, set the Dockerfile path to `apps/web/Dockerfile` and leave the
# root directory as the repository root. If the platform forces the context to
# the app folder, this build will fail on the very first COPY, which is the
# earliest and clearest place for it to fail.

# ---------------------------------------------------------------- base ------
FROM node:22-alpine AS base
# Corepack pins pnpm to the version in package.json, so the image cannot
# silently resolve a different one from the one the lockfile was written with.
RUN corepack enable
WORKDIR /app
ENV CI=true

# --------------------------------------------------------------- deps -------
# Manifests only, so editing source does not invalidate the install layer.
# Every workspace package.json must be listed: pnpm refuses to install a
# workspace it cannot see, even one this app does not import.
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

# --------------------------------------------------------------- build ------
FROM deps AS build
COPY . .

# Vite inlines VITE_* at BUILD time, not at run time. Setting them as runtime
# environment variables on your host does nothing at all: by then the strings
# are already compiled into the bundle. They must be build arguments, and
# changing one requires a rebuild rather than a restart.
#
# VITE_OPERATOR_URL is the one that catches people. It has to be the operator's
# public HTTPS URL, known before this image is built, because the browser posts
# the instruction body there. An HTTPS site cannot call a plain-HTTP operator:
# the browser blocks it as mixed content and the payment strands.
ARG VITE_RULE_REGISTRY_ADDRESS
ARG VITE_RULE_EXECUTOR_ADDRESS
ARG VITE_VAULT_ADDRESS
ARG VITE_OPERATOR_URL
ARG VITE_SITE_URL
ENV VITE_RULE_REGISTRY_ADDRESS=$VITE_RULE_REGISTRY_ADDRESS \
    VITE_RULE_EXECUTOR_ADDRESS=$VITE_RULE_EXECUTOR_ADDRESS \
    VITE_VAULT_ADDRESS=$VITE_VAULT_ADDRESS \
    VITE_OPERATOR_URL=$VITE_OPERATOR_URL \
    VITE_SITE_URL=$VITE_SITE_URL

# routeTree.gen.ts is generated from apps/web/src/routes and is gitignored, so
# a clean checkout does not have it. Generating it explicitly means the build
# does not depend on a plugin side effect having run first.
RUN pnpm --filter @giroledger/web generate-routes && \
    pnpm --filter @giroledger/web build

# ------------------------------------------------------------- runtime ------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web

# Most hosts inject PORT and expect the process to bind it. Falling back to
# 3000 keeps `docker run` working locally without extra flags.
ENV PORT=3000
EXPOSE 3000

# `vite preview` serves the built output. It is not a hardened production
# server; for a testnet demo it is the honest, working option, and swapping it
# for a Node adapter later changes only this line.
CMD ["sh", "-c", "exec pnpm exec vite preview --host 0.0.0.0 --port ${PORT:-3000}"]
