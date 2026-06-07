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

All CLI dev commands run from `lobehub/apps/cli/`. Subsequent examples use `$CLI`:

```bash
CLI="LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts"
```

## Workflow

### Step 1: Ensure Dev Server is Running

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:3011/ 2> /dev/null
```

- **If reachable**: skip to Step 2.
- **If unreachable**: start from cloud repo root:

```bash
pnpm run dev:next
```

To **restart** (pick up server-side code changes):

```bash
lsof -ti:3011 | xargs kill
pnpm run dev:next
```

**Important:** Server-side code changes in the submodule (`lobehub/src/server/`, `lobehub/packages/`) require a server restart. Next.js hot-reload may not pick up changes in submodule packages.

### Step 2: Check CLI Authentication

```bash
cat lobehub/apps/cli/.lobehub-dev/settings.json 2> /dev/null
```

- **If file exists and contains `"serverUrl": "http://localhost:3011"`**: skip to Step 3.
- **If missing or wrong server**: ask the user to run:

```bash
! cd lobehub/apps/cli && LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts login --server http://localhost:3011
```

> Login requires interactive browser authorization (OIDC Device Code Flow), so the user must run it themselves via `!` prefix. Credentials persist in `lobehub/apps/cli/.lobehub-dev/`.

### Step 3: Test with CLI Commands

CLI runs from source, so CLI-side code changes take effect immediately without rebuilding.

```bash
cd lobehub/apps/cli
$CLI <command>
```

### Step 4: Clean Up Test Data

```bash
$CLI task delete < id > -y
$CLI agent delete < id > -y
```

## Common Testing Patterns

### Task System

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

### Agent System

```bash
$CLI agent list
$CLI agent view <agent-id>
$CLI agent run <agent-id> -m "Test prompt"
```

### Document & Knowledge Base

```bash
$CLI doc list
$CLI doc create -t "Test Doc" -c "Content here"
$CLI doc view <doc-id>
$CLI kb list
$CLI kb tree <kb-id>
```

### Model & Provider

```bash
$CLI model list
$CLI provider list
$CLI provider test <provider-id>
```

## Dev-Test Cycle

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
   $CLI <command>
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

## Troubleshooting

| Issue                       | Solution                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| `No authentication found`   | Run `login --server http://localhost:3011`                            |
| `UNAUTHORIZED` on API calls | Token expired; re-run login                                           |
| `ECONNREFUSED`              | Dev server not running; start with `pnpm run dev:next`                |
| CLI shows old data/behavior | Server needs restart to pick up code changes                          |
| `EADDRINUSE` on port 3011   | Server already running; kill with `lsof -ti:3011 \| xargs kill`       |
| Login opens wrong server    | Must use `--server http://localhost:3011` flag (env var doesn't work) |
