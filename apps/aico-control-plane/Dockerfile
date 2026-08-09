# Minimal runtime image for @aico/control-plane.
# Build from monorepo root after `pnpm --filter @aico/control-plane build`.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV AICO_IS_CONTROL_PLANE=1
ENV AICO_CONTROL_PLANE_PORT=3020
COPY apps/aico-control-plane/dist ./dist
# Served via `../web/admin.html` relative to dist/index.js
COPY apps/aico-control-plane/src/web ./web
COPY apps/aico-control-plane/package.json ./
EXPOSE 3020
CMD ["node", "dist/standalone.js"]
