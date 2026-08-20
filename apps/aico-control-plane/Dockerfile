# syntax=docker/dockerfile:1
# Dummy AUTH_SECRET / KEY_VAULTS_SECRET satisfy Next/env checks at build time
# only; they are not production secrets. BuildKit still flags the names.
# check=skip=SecretsUsedInArgOrEnv

# Panachat control-plane image (operator UI + Hono on :3020).
# Build from repo root:
#   docker build -f apps/aico-control-plane/Dockerfile -t panachat-control-plane .
#
# Runtime is self-contained. Do not bind-mount the git checkout over /app.
#
# Image size: apps/aico-control-plane/package.json declares no "dependencies" —
# at runtime it resolves modules (hono, drizzle-orm, etc.) via NODE_PATH into the
# hoisted root node_modules (see ENV below), because this is a pnpm workspace
# where "." is itself a workspace member carrying the real dependency list.
# That means we can't `pnpm deploy --filter` a pruned, package-scoped
# node_modules the way you would for a normal pnpm monorepo app — the whole
# hoisted tree is genuinely load-bearing. What we CAN and must do is strip it
# down to *production* deps before it's copied into the runtime stage, since
# the unpruned tree carries every devDependency for the entire monorepo
# (Vite, TypeScript, lint/format tooling, etc.) — that's most of the ~9.2GB,
# not the vendored ffmpeg binary.

ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-bookworm-slim AS builder

# This repo sets lockfile=false. Do not use frozen-lockfile (headless install
# fails) or pnpm's allow-all-builds config (conflicts with
# onlyBuiltDependencies: neverBuiltDependencies + onlyBuiltDependencies).
# Empty CI so `pnpm run` does not re-install in GitHub Actions / Buildx.
# Add esbuild to the allowlist so Vite has a binary (postinstall is otherwise skipped).
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_OPTIONS=--max-old-space-size=8192 \
    APP_URL=http://app.com \
    DATABASE_DRIVER=node \
    DATABASE_URL=postgres://postgres:password@localhost:5432/postgres \
    KEY_VAULTS_SECRET=use-for-build \
    AUTH_SECRET=use-for-build \
    CI=

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git \
    && rm -rf /var/lib/apt/lists/* \
    && npm i -g corepack@latest && corepack enable

COPY . .

RUN set -e; \
    grep -qE '^[[:space:]]*-[[:space:]]*esbuild$' pnpm-workspace.yaml \
      || sed -i '/^onlyBuiltDependencies:/a\  - esbuild' pnpm-workspace.yaml; \
    corepack use "$(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json)"; \
    pnpm i

RUN pnpm run build:spa:control-plane \
    && pnpm --filter @aico/control-plane build \
    && test -f apps/aico-control-plane/dist/standalone.js \
    && test -f apps/aico-control-plane/web/spa/index.html

# --- Prune the hoisted node_modules down to production deps -----------------
# `pnpm prune --prod` walks the whole workspace and drops any package that is
# only a devDependency somewhere (Vite, TypeScript, lint/test tooling, ...)
# while keeping the union of every workspace member's real "dependencies" —
# which is what the phantom NODE_PATH resolution above actually needs.
FROM builder AS pruner

WORKDIR /app

RUN echo "node_modules before prune:" && du -sh node_modules \
    && pnpm prune --prod \
    && echo "node_modules after prune --prod:" && du -sh node_modules

# Strip docs/tests/maps/caches that ship inside published packages and are
# never read at runtime. Conservative on purpose: no source-file deletion.
RUN find node_modules -depth -type d \
      \( -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'docs' \
         -o -name 'doc' -o -name 'example' -o -name 'examples' -o -name '.cache' \) \
      -not -path '*/node_modules/.pnpm/*/node_modules/*/node_modules/*' \
      -exec rm -rf {} + 2>/dev/null || true \
    && find node_modules -type f \
      \( -name '*.md' -o -name '*.markdown' -o -name 'CHANGELOG*' -o -name '*.map' \
         -o -name '*.ts.map' -o -name '.DS_Store' \) \
      -delete 2>/dev/null || true \
    && echo "node_modules after cache/doc/test strip:" && du -sh node_modules

# ffmpeg-static vendors a full ffmpeg binary (~80MB) and is only ever a real
# dependency for the desktop/server voice pipeline, not this Hono admin API.
# Off by default because we have not statically proven the control-plane
# bundle never imports it — before flipping this on, confirm with:
#   grep -R "ffmpeg-static" apps/aico-control-plane/dist apps/aico-control-plane/src
# and smoke-test the resulting image.
ARG STRIP_FFMPEG_STATIC=false
RUN if [ "$STRIP_FFMPEG_STATIC" = "true" ]; then \
      echo "Stripping ffmpeg-static (STRIP_FFMPEG_STATIC=true)"; \
      rm -rf node_modules/ffmpeg-static; \
      rm -rf node_modules/.pnpm/ffmpeg-static@*; \
    fi

FROM node:${NODEJS_VERSION}-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    AICO_IS_CONTROL_PLANE=1 \
    AICO_CONTROL_PLANE_PORT=3020 \
    HONO_HOST=0.0.0.0 \
    NODE_PATH=/app/node_modules

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=pruner /app/node_modules ./node_modules
COPY --from=pruner /app/apps/aico-control-plane/dist ./dist
COPY --from=pruner /app/apps/aico-control-plane/web/spa ./web/spa
COPY --from=pruner /app/apps/aico-control-plane/src/web ./src/web
COPY --from=pruner /app/apps/aico-control-plane/package.json ./package.json

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --no-create-home nextjs \
    && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3020
CMD ["node", "dist/standalone.js"]
