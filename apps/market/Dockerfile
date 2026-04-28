ARG NODEJS_VERSION="24"

FROM node:${NODEJS_VERSION}-slim

ENV NODE_ENV="production"

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY patches ./patches
COPY apps/market ./apps/market
COPY apps/desktop/src/main/package.json ./apps/desktop/src/main/package.json
COPY packages ./packages

RUN set -e && \
    npm i -g corepack@latest && \
    corepack enable && \
    corepack use $(sed -n 's/.*"packageManager": "\(.*\)".*/\1/p' package.json) && \
    pnpm install --filter @lobechat/market --prod=false --frozen-lockfile=false

CMD ["node", "--import", "tsx", "apps/market/src/index.ts"]
