# Minimal runtime image for @aico/control-plane (optional standalone builds).
# Prefer the moz bind-mount override for local deploys — it reuses the monorepo
# node_modules after `pnpm --filter @aico/control-plane build`.
#
# Standalone image build (from repo root, after control-plane build):
#   docker build -f apps/aico-control-plane/Dockerfile -t aico-control-plane:local .
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV AICO_IS_CONTROL_PLANE=1
ENV AICO_CONTROL_PLANE_PORT=3020
ENV HONO_HOST=0.0.0.0
COPY apps/aico-control-plane/dist ./dist
COPY apps/aico-control-plane/src/web ./web
COPY apps/aico-control-plane/package.json ./
# Resolve external imports from the monorepo install (copied by moz packaging).
COPY node_modules ./node_modules
EXPOSE 3020
CMD ["node", "dist/standalone.js"]
