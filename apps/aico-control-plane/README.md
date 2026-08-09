# Aico control plane

Privileged operations app for Aico. **Not** part of the customer product surface.

## Responsibilities

- Hold `OPENROUTER_MANAGEMENT_API_KEY` (never on the product server)
- Expose token-gated OpenRouter Management proxy at `/internal/openrouter/v1/keys`
- Host `platformAdmin.*` tRPC for operators
- Serve the operator admin UI at `/`

## Env

| Variable                           | Required      | Notes                            |
| ---------------------------------- | ------------- | -------------------------------- |
| `AICO_IS_CONTROL_PLANE`            | yes (`1`)     | Set automatically by `dev` entry |
| `OPENROUTER_MANAGEMENT_API_KEY`    | production    | Real OpenRouter management key   |
| `AICO_CONTROL_PLANE_SERVICE_TOKEN` | yes           | Shared with product server       |
| `DATABASE_URL` / auth secrets      | yes           | Same DB + Better Auth as product |
| `AICO_CONTROL_PLANE_PORT`          | no            | Default `3020`                   |
| `AICO_OPENROUTER_MOCK`             | non-prod only | In-process mock when no key      |

## Product server env

| Variable                           | Notes                           |
| ---------------------------------- | ------------------------------- |
| `AICO_CONTROL_PLANE_URL`           | e.g. `http://localhost:3020`    |
| `AICO_CONTROL_PLANE_SERVICE_TOKEN` | Same token as above             |
| `OPENROUTER_MANAGEMENT_API_KEY`    | **Must be unset** in production |

## Dev

```bash
# from repo root
pnpm --filter @aico/control-plane dev
```

## UI

Runtime operator UI: [`src/web/admin.html`](src/web/admin.html).

React reference panel (future Vite SPA): [`src/ui/PlatformAdminPanel.tsx`](src/ui/PlatformAdminPanel.tsx).
