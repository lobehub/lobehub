# Local Dev Server

Single source of truth for starting / restarting the backend that all test
surfaces (CLI, Electron, Web) hit.

## Resolve ports first

Run `test-env.sh` as described in
[SKILL.md Step 2.0](../../skills/agent-testing/SKILL.md#20-resolve-the-current-test-environment)
before starting or probing any local test surface.

## Ports & modes

| Command             | What it runs                                              | Port source         |
| ------------------- | --------------------------------------------------------- | ------------------- |
| `pnpm run dev:next` | Next.js backend (API + auth)                              | `PORT`              |
| `bun run dev`       | Full-stack (Next.js + Vite SPA, via `devStartupSequence`) | `PORT` + `SPA_PORT` |
| `bun run dev:spa`   | Vite SPA only, proxies API to `PORT`                      | `SPA_PORT`          |

In the **cloud repo** (where this repo is the `lobehub/` submodule), local
worktree names map to fallback defaults only when `.env` and shell env do not
provide values:

| Workspace directory | Default `SERVER_URL`             |
| ------------------- | -------------------------------- |
| `lobehub`           | `http://localhost:3010`          |
| `lobehub-cloud`     | `http://localhost:3020`          |
| `lobehub-cloud-1`   | `http://localhost:3021`          |
| `lobehub-cloud-N`   | `http://localhost:$((3020 + N))` |

`test-env.sh` and `setup-auth.sh` both use the resolved env first and these
worktree defaults only as fallback. Treat the dev-server terminal output as the
final source of truth when testing a non-standard port, then export it for every
agent-testing command:

```bash
export SERVER_URL=http://localhost:<port-from-dev-output>
```

## Health check

```bash
curl -s -o /dev/null -w '%{http_code}' "$SERVER_URL/"
```

## Start / restart

```bash
# Start backend only.
# With root .env: use the existing local config.
# Agent runtime queue mode is required to mirror production async execution.
AGENT_RUNTIME_MODE=queue pnpm run dev:next

# Without root .env: use the self-contained agent-testing env.
.agents/verify/scripts/init-dev-env.sh dev-next

# Full-stack SPA + backend. Required for Web smoke.
# With root .env:
AGENT_RUNTIME_MODE=queue bun run dev

# Without root .env:
.agents/verify/scripts/init-dev-env.sh dev

# Local QStash. Run in a separate terminal only when testing workflow paths.
.agents/verify/scripts/init-dev-env.sh qstash

# Restart — required to pick up server-side code changes.
# For a no-.env server started by init-dev-env.sh, stop only its owned process tree:
.agents/verify/scripts/init-dev-env.sh stop-dev
.agents/verify/scripts/init-dev-env.sh dev-next
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

| Issue                     | Solution                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `ECONNREFUSED`            | Server not running — start it                                                                   |
| `EADDRINUSE` on the port  | Inspect the listener; stop it only if this run owns it. Never kill an unknown PID by port alone |
| Stale data / old behavior | Server needs a restart to pick up code changes                                                  |
| Agent call runs inline    | Set `AGENT_RUNTIME_MODE=queue`, make sure `REDIS_URL` is configured, then restart the server    |
| Queue mode needs Redis    | Run `init-dev-env.sh setup-db`, or provide `REDIS_URL=redis://...` for an existing Redis        |
| QStash workflow failures  | Start `init-dev-env.sh qstash` and make sure dev server inherited the script's `QSTASH_*` env   |

Marketplace/community endpoints are not part of the local agent-testing auth
gate. Do not block local product-chain verification on marketplace API auth
unless the change explicitly targets marketplace behavior.
