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

| Requirement  | Details                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| Dev server   | `localhost:3010` — see [../references/dev-server.md](../references/dev-server.md) |
| CLI source   | `apps/cli/` — runs from source, no rebuild needed                                 |
| CLI dev mode | `LOBEHUB_CLI_HOME=.lobehub-dev` for isolated credentials                          |
| Auth         | Device Code Flow login — see [../references/auth.md](../references/auth.md)       |

All CLI dev commands run from `apps/cli/`. Subsequent examples use `$CLI`:

```bash
CLI="LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts"
```

## Workflow

### Step 1 — Server up?

See [../references/dev-server.md](../references/dev-server.md) for the health
check, start, and restart commands. Server-side code changes require a restart.

### Step 2 — Auth ready?

```bash
./.agents/skills/agent-testing/scripts/setup-auth.sh status
```

If the CLI is not logged in, **the user must run the login themselves**
(interactive browser authorization):

```bash
cd apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3010
```

Credentials persist in `apps/cli/.lobehub-dev/`. Details:
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

```bash
$CLI agent list
$CLI agent view <agent-id>
$CLI agent run <agent-id> -m "Test prompt"
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

| Issue                       | Solution                                        |
| --------------------------- | ----------------------------------------------- |
| `No authentication found`   | Run `login --server http://localhost:3010`      |
| `UNAUTHORIZED` on API calls | Token expired; re-run login                     |
| `ECONNREFUSED`              | Dev server not running — see dev-server.md      |
| CLI shows old data/behavior | Server needs restart to pick up code changes    |
| Login opens wrong server    | Must use `--server` flag (env var doesn't work) |
