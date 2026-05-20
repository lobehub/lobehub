---
name: cli-backend-testing
description: >
  CLI + Backend integration testing workflow. Use when verifying backend API changes
  (TRPC routers, services, models) via the LobeHub CLI against a local dev server.
  Triggers on 'cli test', 'test with cli', 'verify with cli', 'local cli test',
  'backend test with cli', or when needing to validate server-side changes end-to-end.
---

# CLI + Backend Integration Testing

Standard workflow for verifying backend changes using the LobeHub CLI (`lh`) against a local dev server.

## When to Use

- Verifying TRPC router / service / model changes end-to-end
- Testing new API fields or response structure changes
- Validating CLI command output after backend modifications
- Debugging data flow issues between server and CLI

## Prerequisites

| Requirement  | Details                                                       |
| ------------ | ------------------------------------------------------------- |
| Dev server   | `localhost:3011` (Next.js)                                    |
| CLI source   | `lobehub/apps/cli/`                                           |
| CLI dev mode | Uses `LOBEHUB_CLI_HOME=.lobehub-dev` for isolated credentials |
| Auth         | Device Code Flow login to local server                        |

## Quick Reference

All CLI dev commands run from `lobehub/apps/cli/`:

```bash
# Shorthand for all commands below
CLI="LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts"
```

## Workflow

### Step 1: Ensure Dev Server is Running

Check if the dev server is already running:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3011/ 2> /dev/null
```

- **If reachable** (returns any HTTP status): server is running. Skip to Step 2.
- **If unreachable**: start the server:

```bash
# From cloud repo root
pnpm run dev:next
```

To **restart** (pick up server-side code changes):

```bash
lsof -ti:3011 | xargs kill
pnpm run dev:next
```

**Important:** Server-side code changes in the submodule (`lobehub/src/server/`, `lobehub/packages/`) require a server restart. Next.js hot-reload may not pick up changes in submodule packages.

### Step 2: Check CLI Authentication

Check if dev credentials already exist:

```bash
cat lobehub/apps/cli/.lobehub-dev/settings.json 2> /dev/null
```

- **If file exists and contains `"serverUrl": "http://localhost:3011"`**: already authenticated. Skip to Step 3.
- **If file missing or points to wrong server**: login is needed. Ask the user to run:

```bash
! cd lobehub/apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3011
```

> Login requires interactive browser authorization (OIDC Device Code Flow), so the user must run it themselves via `!` prefix. After login, credentials are saved to `lobehub/apps/cli/.lobehub-dev/` and persist across sessions.

### Step 3: Test with CLI Commands

CLI runs from source (`bun src/index.ts`), so CLI-side code changes take effect immediately without rebuilding.

```bash
cd lobehub/apps/cli
LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts <command>
```

### Step 4: Clean Up Test Data

Delete any test data created during verification:

```bash
LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts task delete < id > -y
LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts agent delete < id > -y
```

## Common Testing Patterns

### Task System

```bash
# List tasks
$CLI task list

# Create test data with nesting
$CLI task create -n "Root Task" -i "Test instruction"
$CLI task create -n "Child Task" -i "Sub instruction" --parent T-1

# View task detail (tests getTaskDetail service)
$CLI task view T-1

# View task tree
$CLI task tree T-1

# Test lifecycle
$CLI task edit T-1 --status running
$CLI task comment T-1 -m "Test comment"

# Clean up
$CLI task delete T-1 -y
```

### Agent System

```bash
# List agents
$CLI agent list

# View agent detail
$CLI agent view <agent-id>

# Run agent (tests agent execution pipeline)
$CLI agent run <agent-id> -m "Test prompt"
```

### Document & Knowledge Base

```bash
# List documents
$CLI doc list

# Create and view
$CLI doc create -t "Test Doc" -c "Content here"
$CLI doc view <doc-id>

# Knowledge base
$CLI kb list
$CLI kb tree <kb-id>
```

### Model & Provider

```bash
# List models and providers
$CLI model list
$CLI provider list

# Test provider connectivity
$CLI provider test <provider-id>
```

## Dev-Test Cycle

The standard cycle for backend development:

```
1. Make code changes (service/model/router/type)
         |
2. Run unit tests (fast feedback)
   bunx vitest run --silent='passed-only' '<test-file>'
         |
3. Restart dev server (if server-side changes)
   lsof -ti:3011 | xargs kill && pnpm run dev:next
         |
4. CLI verification (end-to-end)
   LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts <command>
         |
5. Clean up test data
```

### When Server Restart is Needed

| Change Location                           | Restart? |
| ----------------------------------------- | -------- |
| `lobehub/src/server/` (routers, services) | Yes      |
| `lobehub/packages/database/` (models)     | Yes      |
| `lobehub/packages/types/`                 | Yes      |
| `lobehub/packages/prompts/`               | Yes      |
| `lobehub/apps/cli/` (CLI code)            | No       |
| `src/` (cloud overrides)                  | Yes      |

### When Server Restart is NOT Needed

CLI runs from source via `bun src/index.ts`, so any changes to `lobehub/apps/cli/src/` take effect immediately on next command invocation.

## Troubleshooting

| Issue                       | Solution                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| `No authentication found`   | Run `login --server http://localhost:3011`                            |
| `UNAUTHORIZED` on API calls | Token expired; re-run login                                           |
| `ECONNREFUSED`              | Dev server not running; start with `pnpm run dev:next`                |
| CLI shows old data/behavior | Server needs restart to pick up code changes                          |
| `EADDRINUSE` on port 3011   | Server already running; kill with `lsof -ti:3011 \| xargs kill`       |
| Login opens wrong server    | Must use `--server http://localhost:3011` flag (env var doesn't work) |

## Credential Isolation

| Mode       | Credential Dir                   | Server            |
| ---------- | -------------------------------- | ----------------- |
| Dev        | `lobehub/apps/cli/.lobehub-dev/` | `localhost:3011`  |
| Production | `~/.lobehub/`                    | `app.lobehub.com` |

The two environments are completely isolated. Dev mode credentials are gitignored.
