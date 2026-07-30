# syntax=docker/dockerfile:1

# GiroLedger. One Dockerfile, three targets: web, operator, keeper.
#
# The two services and the site share a pnpm workspace and a lockfile, so they
# share a dependency layer too. Build a specific one with --target:
#
#   docker build --target operator -t giroledger-operator .
#
# or let docker-compose.yml do it.

# ---------------------------------------------------------------- base ------
FROM node:22-alpine AS base
# Corepack pins pnpm to the version in package.json, so the image cannot
# silently resolve a different one from the one the lockfile was written with.
RUN corepack enable
WORKDIR /app
ENV CI=true

# --------------------------------------------------------------- deps -------
# Manifests only, so a source edit does not invalidate the install layer. Every
# workspace package.json must be listed: pnpm refuses to install a workspace it
# cannot see.
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

# Vite inlines VITE_* at BUILD time, not at run time. Passing them as runtime
# environment variables does nothing: the strings are already compiled into the
# bundle. So they are build arguments, and rebuilding is required to change them.
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

# routeTree.gen.ts is generated from apps/web/src/routes and gitignored, so a
# clean checkout does not have it. Generating it explicitly means the build does
# not depend on a plugin side effect having run first.
RUN pnpm --filter @giroledger/web generate-routes && \
    pnpm --filter @giroledger/web build

# ----------------------------------------------------------------- web ------
FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
# `vite preview` serves the built SSR output. It is not a hardened production
# server; for a testnet demo it is the honest, working option, and swapping it
# for a Node adapter later changes only this line.
CMD ["pnpm", "--filter", "@giroledger/web", "preview", "--host", "0.0.0.0", "--port", "3000"]

# ------------------------------------------------------------ operator ------
# The services run their TypeScript directly through tsx. Their `build` script
# is `tsc --noEmit`, a type check that emits nothing, so there is no compiled
# output to copy and pretending otherwise would produce an image that cannot run.
FROM base AS operator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/operator/node_modules ./apps/operator/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/operator ./apps/operator
# Pending instructions and held payments live here. Without a volume, a restart
# forgets every in-flight payment, which means a user's XRP sits at the Core
# Vault until someone completes it by hand.
VOLUME ["/app/apps/operator/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
WORKDIR /app/apps/operator
CMD ["pnpm", "exec", "tsx", "src/index.ts"]

# -------------------------------------------------------------- keeper ------
FROM base AS keeper
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/keeper/node_modules ./apps/keeper/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared ./packages/shared
COPY apps/keeper ./apps/keeper
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health >/dev/null || exit 1
WORKDIR /app/apps/keeper
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
