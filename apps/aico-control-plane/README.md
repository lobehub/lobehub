# Aico control plane

Privileged operations app for Aico. **Not** part of the customer product surface.

## Responsibilities

- Hold `OPENROUTER_MANAGEMENT_API_KEY` (never on the product server)
- Expose token-gated OpenRouter Management proxy at `/internal/openrouter/v1/keys`
- Host `platformAdmin.*` tRPC for operators
- Serve the operator admin UI (built SPA) at `/` on the **same port** as the API

## Env

| Variable                             | Required   | Notes                                                                                                                       |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AICO_IS_CONTROL_PLANE`              | yes (`1`)  | Set automatically by `dev` entry                                                                                            |
| `OPENROUTER_MANAGEMENT_API_KEY`      | production | Real OpenRouter management key                                                                                              |
| `AICO_CONTROL_PLANE_SERVICE_TOKEN`   | yes        | Shared with product. ≥24 chars; `devtok` rejected at startup                                                                |
| `DATABASE_URL` / auth secrets        | yes        | Same DB + Better Auth as product                                                                                            |
| `AICO_CONTROL_PLANE_PORT`            | no         | Host port (default `3020`, moz binds `127.0.0.1` only)                                                                      |
| `AICO_CONTROL_PLANE_PUBLIC_URL`      | no         | Browser origin (default `http://localhost:3020`). Set to any domain when reverse-proxying, e.g. `https://admin.example.com` |
| `AICO_INSECURE_AUTH_COOKIES`         | no         | `1` for HTTP; use `0` when PUBLIC\_URL is `https://`                                                                        |
| `AICO_OPENROUTER_MOCK`               | local QA   | Mock when no management key; needs `AICO_ALLOW_INSECURE_CONTROL_PLANE=1` under `NODE_ENV=production`                        |
| `AICO_ALLOW_CONTROL_PLANE_MOCK_AUTH` | no         | Never set in shared envs — re-enables tRPC mock-user bypass on the control plane                                            |

Better Auth runs **on this process** (`/api/auth/*`). `APP_URL` must equal the public browser origin.

### Security notes

- Do **not** use placeholder tokens (`devtok`). `moz` generates `openssl rand -hex 32` when missing/weak.
- Control plane defaults to `NODE_ENV=production` so `ENABLE_MOCK_DEV_USER` / `lobe-auth-dev-backend-api` cannot elevate to platform admin.
- Publish `:3020` on loopback only unless you put TLS + network policy in front.

## Product server env

| Variable                           | Notes                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `AICO_CONTROL_PLANE_URL`           | e.g. `http://localhost:3020`                                              |
| `AICO_CONTROL_PLANE_SERVICE_TOKEN` | Same token as above                                                       |
| `AICO_CONTROL_PLANE_UI_URL`        | Browser origin of control plane (merged into Better Auth trusted origins) |
| `OPENROUTER_MANAGEMENT_API_KEY`    | **Must be unset** in production                                           |

## One port (recommended)

Operator UI + API share **<http://localhost:3020/>**.

```bash
# build SPA into apps/aico-control-plane/web/spa + Hono dist
bun run build:spa:control-plane
pnpm --filter @aico/control-plane build

# run
env AICO_CONTROL_PLANE_SERVICE_TOKEN=devtok \
  AICO_PRODUCT_URL=http://127.0.0.1:3210 \
  bun run dev:control-plane
```

Or via **moz** (builds + deploys product and control plane together):

```bash
moz -u # full build + deploy
moz -d # recreate lobe + aico-control-plane
moz -i # status includes control-plane /health
```

Open **<http://127.0.0.1:3020/>** — design-system panel with login. Auth is proxied to the product app; tRPC stays on 3020.

## Optional Vite HMR (3021)

Only for UI development with hot reload:

```bash
bun run dev:spa:control-plane # http://localhost:3021 → proxies /trpc to 3020
```

Normal operators / moz do **not** need 3021.

## Platform admin seed

Sign in with a user that exists in `platform_admins` (same Better Auth users as the product).
