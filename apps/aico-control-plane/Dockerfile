# Panachat control-plane image (operator UI + Hono on :3020).
# Build from repo root:
#   docker build -f apps/aico-control-plane/Dockerfile -t panachat-control-plane .
#
# Runtime is self-contained. Do not bind-mount the git checkout over /app.

ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_OPTIONS=--max-old-space-size=8192 \
    APP_URL=http://app.com \
    DATABASE_DRIVER=node \
    DATABASE_URL=postgres://postgres:password@localhost:5432/postgres \
    KEY_VAULTS_SECRET=use-for-build \
    AUTH_SECRET=use-for-build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 make g++ git \
    && rm -rf /var/lib/apt/lists/* \
    && npm i -g corepack@latest && corepack enable

COPY . .

RUN corepack use "$(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json)" \
    && pnpm i --frozen-lockfile \
    && pnpm run build:spa:control-plane \
    && pnpm --filter @aico/control-plane build \
    && test -f apps/aico-control-plane/dist/standalone.js \
    && test -f apps/aico-control-plane/web/spa/index.html

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

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/aico-control-plane/dist ./dist
COPY --from=builder /app/apps/aico-control-plane/web/spa ./web/spa
COPY --from=builder /app/apps/aico-control-plane/src/web ./src/web
COPY --from=builder /app/apps/aico-control-plane/package.json ./package.json

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --no-create-home nextjs \
    && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3020
CMD ["node", "dist/standalone.js"]
