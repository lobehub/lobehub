# Local Dev Server

Single source of truth for starting / restarting the backend that all test
surfaces (CLI, Electron, Web) hit.

## Resolve ports first

Run `test-env.sh` as described in
[PROCESS.md Step 2](../PROCESS.md#step-2--environment-and-auth)
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
.agents/acceptance/scripts/init-dev-env.sh dev-next

# Full-stack SPA + backend. Required for Web smoke.
# With root .env:
AGENT_RUNTIME_MODE=queue bun run dev

# Without root .env:
.agents/acceptance/scripts/init-dev-env.sh dev

# Local QStash. Run in a separate terminal only when testing workflow paths.
.agents/acceptance/scripts/init-dev-env.sh qstash

# Restart — required to pick up server-side code changes.
# For a no-.env server started by init-dev-env.sh, stop only its owned process tree:
.agents/acceptance/scripts/init-dev-env.sh stop-dev
.agents/acceptance/scripts/init-dev-env.sh dev-next
```

## Root `.env` exists but does not boot

`init-dev-env.sh` hard-blocks whenever the repo root has a `.env`, and the
`.env` branch above assumes that config is sound. When it is not — expired
database credentials, a database whose schema is behind the checkout (missing
`agent_history_jobs`, so sign-in 500s), or `setup-auth.sh` refusing with
`root .env exists; do not seed or modify this DB` — do not repair it in place.

That `.env` belongs to whoever set it up. Patching it (or patching
`node_modules`) to get one run going leaves their environment broken and hides
the real cause. Open a throwaway worktree instead: it has no root `.env`, so the
bootstrap branch applies and nothing is shared with that config.

A bare worktree is not enough — it has no `node_modules`, and the bootstrap runs
through the repo's own tooling. Provision it, keep the shared containers off each
other's state, and invoke everything by absolute path:

```bash
WT=/tmp/lh-acceptance-<slug>
SRC=<working checkout>
# --detach so a ref already checked out elsewhere (i.e. the branch under test) is legal.
git worktree add --detach "$WT" <ref-or-sha>

# 1. Install (L-S23): copy $SRC's install rather than resolving a lockfile-less repo.
#    -c is APFS clonefile (macOS); drop it on Linux.
cp -Rc "$SRC/node_modules" "$WT/node_modules"
( cd "$SRC" && find . -mindepth 2 -maxdepth 3 -name node_modules -type d ) | while read -r rel; do
  mkdir -p "$WT/$(dirname "$rel")"
  cp -Rc "$SRC/$rel" "$WT/$rel"
done
# symlink any workspace package this branch adds into "$WT/node_modules/@lobechat/"

# 2. Ports (L-S20): the managed containers are reused, possibly on non-default hosts.
docker ps --format '{{.Names}} {{.Ports}}' | grep lobehub-agent-testing
export DB_PORT=<from docker ps> REDIS_PORT=<from docker ps>

# 3. Database of your own (L-S9): a sibling run's migrations and fixture
#    truncation must not land here.
"$WT/.agents/acceptance/scripts/init-dev-env.sh" setup-db
docker exec lobehub-agent-testing-postgres psql -U postgres -c "CREATE DATABASE lh_acceptance_<slug>"
docker exec lobehub-agent-testing-postgres psql -U postgres -d lh_acceptance_<slug> -c "CREATE EXTENSION IF NOT EXISTS vector"
export DATABASE_URL="postgresql://postgres:postgres@localhost:$DB_PORT/lh_acceptance_<slug>"

# 4. Bootstrap, absolute paths (L-S21).
"$WT/.agents/acceptance/scripts/init-dev-env.sh" migrate
"$WT/.agents/acceptance/scripts/init-dev-env.sh" seed-user
"$WT/.agents/acceptance/scripts/init-dev-env.sh" dev         # or dev-next
```

`setup-db` still migrates the default `postgres` database on the way; step 4's
`migrate` is what the run actually uses.

Teardown reverses all of it — the worktree is throwaway, and on Linux the copy is
a real ~6.8 GB, not a clonefile:

```bash
"$WT/.agents/acceptance/scripts/init-dev-env.sh" clean   # stop only this run's server
docker exec lobehub-agent-testing-postgres psql -U postgres -c "DROP DATABASE IF EXISTS lh_acceptance_<slug>"
git worktree remove --force "$WT"
```

Leave the shared `postgres` database holding the other session's rows.

The containers are the part that costs nothing the second time (`setup-db` is a
no-op when they are up); the price of this path is one checkout plus a
dependency copy. Record the worktree path in the report.

## When a server restart is needed

Next.js hot-reload may not pick up changes in workspace packages — restart when
in doubt.

| Change location                                 | Restart? |
| ----------------------------------------------- | -------- |
| `apps/server/src/` (routers, services, modules) | Yes      |
| `apps/server/src/router-hono/`                  | Yes      |
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
| Root `.env` present but dev fails (sign-in 500, schema behind the checkout) | Do not repair it in place — see [Root `.env` exists but does not boot](#root-env-exists-but-does-not-boot) |
| `setup-auth.sh`: `root .env exists; do not seed` | Same: clean worktree without a root `.env`, then `init-dev-env.sh seed-user` |

Marketplace/community endpoints are not part of the local agent-testing auth
gate. Do not block local product-chain verification on marketplace API auth
unless the change explicitly targets marketplace behavior.
