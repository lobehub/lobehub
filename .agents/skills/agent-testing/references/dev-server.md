# Local Dev Server

Single source of truth for starting / restarting the backend that all test
surfaces (CLI, Electron, Web) hit.

## Ports & modes

| Command             | What it runs                                              | Port                              |
| ------------------- | --------------------------------------------------------- | --------------------------------- |
| `pnpm run dev:next` | Next.js backend (API + auth)                              | `3010`                            |
| `bun run dev`       | Full-stack (Next.js + Vite SPA, via `devStartupSequence`) | `3010` (API) + SPA on `9876`      |
| `bun run dev:spa`   | Vite SPA only, proxies API to `3010`                      | `9876` (prints a Debug Proxy URL) |

In the **cloud repo** (where this repo is the `lobehub/` submodule) the dev
server conventionally runs on `3011` — set `SERVER_URL=http://localhost:3011`
for the scripts in this skill when testing there.

## Health check

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3010/
```

## Start / restart

```bash
# Start backend only.
# With root .env: use the existing local config.
pnpm run dev:next

# Without root .env: use the self-contained agent-testing env.
./.agents/skills/agent-testing/scripts/init-dev-env.sh dev-next

# Full-stack SPA + backend. Required for Web smoke.
# With root .env:
bun run dev

# Without root .env:
./.agents/skills/agent-testing/scripts/init-dev-env.sh dev

# Restart — required to pick up server-side code changes
lsof -ti:3010 | xargs kill
pnpm run dev:next
# or, when no root .env exists:
# ./.agents/skills/agent-testing/scripts/init-dev-env.sh dev-next
```

## When a server restart is needed

Next.js hot-reload may not pick up changes in workspace packages — restart when
in doubt.

| Change location                                 | Restart? |
| ----------------------------------------------- | -------- |
| `apps/server/src/` (routers, services, modules) | Yes      |
| `src/server/` (agent-hono, workflows-hono)      | Yes      |
| `packages/database/` (models)                   | Yes      |
| `packages/types/`                               | Yes      |
| `packages/prompts/`                             | Yes      |
| `apps/cli/` (CLI runs from source)              | No       |

## Troubleshooting

| Issue                     | Solution                                                |
| ------------------------- | ------------------------------------------------------- |
| `ECONNREFUSED`            | Server not running — start it                           |
| `EADDRINUSE` on the port  | Already running — `lsof -ti:<port> \| xargs kill` first |
| Stale data / old behavior | Server needs a restart to pick up code changes          |
