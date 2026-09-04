# Standalone Hono runtime (tRPC + /api/agent + /api/workflows) without Next.js.
# Build context must be the repository root:
#   docker build -f apps/server/Dockerfile -t lobehub-hono .
ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-slim AS builder

ARG USE_CN_MIRROR
ENV NODE_OPTIONS="--max-old-space-size=8192"

WORKDIR /app

COPY package.json pnpm-workspace.yaml .npmrc ./
COPY packages ./packages
COPY patches ./patches
COPY apps/server/package.json ./apps/server/package.json
COPY apps/desktop/src/main/package.json ./apps/desktop/src/main/package.json
COPY apps/share/package.json ./apps/share/package.json
COPY apps/workbench/package.json ./apps/workbench/package.json

RUN set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        npm config set registry "https://registry.npmmirror.com/"; \
    fi && \
    export COREPACK_NPM_REGISTRY=$(npm config get registry | sed 's/\/$//') && \
    npm i -g corepack@latest && \
    corepack enable && \
    corepack use $(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json) && \
    pnpm i

COPY . .

RUN pnpm --filter @lobechat/server build

# The bundle inlines @lobechat/* but leaves third-party packages external, so the runtime
# image only needs the packages the bundle actually imports, pinned to the builder's versions.
RUN mkdir -p /deps && \
    pnpm exec tsx scripts/honoRuntimeDeps.mts --dist apps/server/dist --out /deps && \
    cp -r patches /deps/patches && \
    cd /deps && \
    pnpm i --prod

FROM node:${NODEJS_VERSION}-slim AS app

ENV NODE_ENV="production"

WORKDIR /app

COPY --from=builder /app/apps/server/package.json /app/package.json
COPY --from=builder /deps/node_modules /app/node_modules
COPY --from=builder /app/apps/server/dist /app/dist

USER node

EXPOSE 3011/tcp

CMD ["node", "dist/standalone.js"]
