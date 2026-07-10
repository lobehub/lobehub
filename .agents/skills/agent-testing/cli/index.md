# CLI Backend Verification

Default surface for verifying **backend changes** (TRPC routers, services,
models, migrations) end-to-end: fastest loop, text-assertable output, zero UI
flakiness.

## When to use

- Verifying TRPC router / service / model changes end-to-end
- Testing new API fields or response structure changes
- Validating CLI command output after backend modifications
- Debugging data flow issues between server and CLI

## Prerequisites

| Requirement  | Details                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dev server   | `localhost:3010` — see [../references/dev-server.md](../references/dev-server.md)                                                              |
| CLI source   | `apps/cli/` — runs from source, no rebuild; standalone `node_modules` — run `pnpm install` inside `apps/cli/` (root install does not cover it) |
| CLI dev mode | `LOBEHUB_CLI_HOME=.lobehub-dev` for isolated settings                                                                                          |
| Auth         | Seeded API key first; Device Code Flow only as fallback — see [../references/auth.md](../references/auth.md)                                   |
| QStash       | **Required for `agent run`** (queue mode). Start `init-dev-env.sh qstash` and verify with `init-dev-env.sh preflight` — see below              |

All CLI dev commands run from `apps/cli/`. Subsequent examples use `$CLI`:

```bash
source ../../.records/env/agent-testing-cli.env
CLI="bun src/index.ts"
```

## Workflow

### Step 1 — Server up?

See [../references/dev-server.md](../references/dev-server.md) for the health
check, start, and restart commands. Server-side code changes require a restart.

### Step 2 — Auth ready?

```bash
./.agents/skills/agent-testing/scripts/setup-auth.sh status
```

If the CLI is not ready in the seeded local environment:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh seed-user
source .records/env/agent-testing-cli.env
./.agents/skills/agent-testing/scripts/setup-auth.sh cli-seed
```

If the target environment is not seeded, use the interactive fallback:

```bash
cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3010
```

Seeded API-key auth does not store credentials. It writes local settings under
`$HOME/.lobehub-dev` and requires the generated env file to be sourced before
CLI commands. Details:
[../references/auth.md](../references/auth.md).

### Step 3 — Test with CLI commands

CLI runs from source, so CLI-side code changes take effect immediately without
rebuilding:

```bash
cd apps/cli
$CLI <command>
```

Capture output for the report as you go (e.g. `$CLI task list | tee "$DIR/assets/task-list.txt"`).

### Step 4 — Clean up test data

```bash
$CLI task delete < id > -y
$CLI agent delete < id > -y
```

### Step 5 — Report

Finish with a structured report —
[../references/report.md](../references/report.md). CLI evidence = exact
command + trimmed output.

## Common testing patterns

### Task system

```bash
$CLI task list
$CLI task create -n "Root Task" -i "Test instruction"
$CLI task create -n "Child Task" -i "Sub instruction" --parent T-1
$CLI task view T-1
$CLI task tree T-1
$CLI task edit T-1 --status running
$CLI task comment T-1 -m "Test comment"
$CLI task delete T-1 -y
```

### Agent system

`agent run` executes through the **server agent runtime in queue mode**, which
POSTs the operation to local QStash (`127.0.0.1:8080`). If QStash is not
running, the run fails at operation creation with `fetch failed` /
`ECONNREFUSED 127.0.0.1:8080` **before any LLM call** — and no trace is
recorded. So before running an agent, start QStash and gate on the preflight:

```bash
./.agents/skills/agent-testing/scripts/init-dev-env.sh qstash      # separate terminal — keep running
./.agents/skills/agent-testing/scripts/init-dev-env.sh preflight    # non-zero exit if QStash/Redis is down
```

```bash
$CLI agent list
$CLI agent view <agent-id>
$CLI agent run <agent-id> -m "Test prompt"   # requires QStash (see preflight above)
```

### Document & knowledge base

```bash
$CLI doc list
$CLI doc create -t "Test Doc" -c "Content here"
$CLI doc view <doc-id>
$CLI kb list
$CLI kb tree <kb-id>
```

### Model & provider

```bash
$CLI model list
$CLI provider list
$CLI provider test <provider-id>
```

## Dev-test cycle

```
1. Make code changes (service/model/router/type)
         |
2. Run unit tests (fast feedback)
   bunx vitest run --silent='passed-only' '<test-file>'
         |
3. Restart dev server (if server-side changes — see dev-server.md)
         |
4. CLI verification (end-to-end)
   $CLI <command>
         |
5. Clean up test data + write the report
```

## Troubleshooting

| Issue                       | Solution                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `No authentication found`   | Source `.records/env/agent-testing-cli.env`, or run device-code `login --server http://localhost:3010` |
| `UNAUTHORIZED` on API calls | Re-run `init-dev-env.sh seed-user` and re-source the env file; for device-code fallback, re-run login  |
| `ECONNREFUSED`              | Dev server not running — see dev-server.md                                                             |
| CLI shows old data/behavior | Server needs restart to pick up code changes                                                           |
| Login opens wrong server    | Must use `--server` flag (env var doesn't work)                                                        |
