---
name: cli
description: LobeHub CLI (@lobehub/cli) development guide — commands, subcommands, architecture.
disable-model-invocation: true
---

# LobeHub CLI Development Guide

## Overview

LobeHub CLI (`@lobehub/cli`) is a command-line tool for managing and interacting with LobeHub services. Built with Commander.js + TypeScript.

- **Package**: `apps/cli/`
- **Entry**: `apps/cli/src/index.ts`
- **Binaries**: `lh`, `lobe`, `lobehub` (all aliases for the same CLI)
- **Build**: tsup
- **Runtime**: Node.js / Bun

## Architecture

```
apps/cli/src/
├── index.ts                  # Entry point — parses argv, invokes program.ts
├── program.ts                # Builds the Commander program, registers every command
├── api/
│   ├── client.ts             # tRPC client (type-safe backend API)
│   └── http.ts               # Raw HTTP utilities
├── auth/
│   ├── credentials.ts        # Encrypted credential storage (AES-256-GCM)
│   ├── identity.ts           # Account fingerprint for machine-local state
│   ├── refresh.ts            # Token auto-refresh
│   └── resolveToken.ts       # Token resolution (flag > stored)
├── commands/                 # All CLI commands (one file per command group)
│   ├── agent.ts              # Agent CRUD + run
│   ├── agent-group.ts        # Agent group CRUD
│   ├── agent-signal/         # Inspect and trigger Agent Signal source events
│   ├── artifact.ts           # Publish local HTML pages as artifacts
│   ├── bot.ts                # Bot integrations (channels, access policies, messengers)
│   ├── completion.ts         # Shell completion script output
│   ├── config.ts             # whoami, usage
│   ├── connect.ts            # Device gateway connection + daemon
│   ├── device.ts             # Manage connected devices
│   ├── doc.ts                # Document management
│   ├── doctor.ts             # Machine diagnostics (runtime, endpoints, credentials, readiness)
│   ├── eval.ts               # Evaluation workflows & benchmarks
│   ├── file.ts               # File management
│   ├── generate/             # Content generation (text/image/video/tts/asr)
│   ├── goal.ts               # Long-horizon Goal Graphs
│   ├── hetero.ts             # Run heterogeneous agent CLIs, stream their output
│   ├── kb.ts                 # Knowledge base management
│   ├── login.ts              # OIDC Device Code Flow / API key auth
│   ├── logout.ts             # Clear credentials
│   ├── man.ts                # CLI manual pages
│   ├── memory.ts             # User memory management
│   ├── message.ts            # Message management
│   ├── migrate/              # Import data from external tools (OpenClaw, ChatGPT, Claude, etc.)
│   ├── model.ts              # AI model management
│   ├── notify.ts             # Send a callback message to a topic to trigger the agent
│   ├── plugin.ts             # Plugin management
│   ├── project.ts            # Goal-oriented project management
│   ├── provider.ts           # AI provider management
│   ├── search.ts             # Global search
│   ├── session-group.ts      # Agent session group management
│   ├── skill.ts              # Agent skill management
│   ├── status.ts             # Gateway connectivity check
│   ├── task/                 # Agent task management (assignees, checkpoints, deps, review)
│   ├── thread.ts             # Message thread management
│   ├── topic.ts              # Conversation topic management
│   ├── trace/                # Inspect and replay recorded agent execution traces
│   ├── update.ts             # Self-update to the latest published version
│   ├── user.ts               # User account & settings
│   ├── verify.ts             # Agent Run verification machinery (criteria, rubrics, check plans)
│   ├── verifyAcceptance.ts   # `lh acceptance`: cross-round delivery review loop
│   └── workspace.ts          # Workspace list/scope/members/usage/audit
├── daemon/
│   └── manager.ts            # Background daemon process management
├── tools/
│   ├── shell.ts              # Shell command execution (for gateway)
│   └── file.ts               # File operations (for gateway)
├── settings/
│   └── index.ts              # Persistent settings (~/.lobehub/)
├── utils/
│   ├── logger.ts             # Logging (verbose mode)
│   ├── format.ts             # Table output, JSON, timeAgo/timeUntil, truncate
│   └── agentStream.ts        # SSE streaming for agent runs
└── constants/
    └── urls.ts               # Official server & gateway URLs
```

## Command Groups

| Command            | Alias | Description                                                                        |
| ------------------ | ----- | ---------------------------------------------------------------------------------- |
| `lh login`         | -     | Authenticate via OIDC Device Code Flow or API key                                  |
| `lh logout`        | -     | Clear stored credentials                                                           |
| `lh connect`       | -     | Device gateway connection & daemon management                                      |
| `lh device`        | -     | Manage connected devices                                                           |
| `lh status`        | -     | Quick gateway connectivity check                                                   |
| `lh doctor`        | -     | Diagnose machine readiness (runtime, endpoints, credentials, scope, device, agent) |
| `lh agent`         | -     | Agent CRUD, run, status                                                            |
| `lh agent-group`   | -     | Agent group CRUD                                                                   |
| `lh agent-signal`  | -     | Inspect and trigger Agent Signal source events                                     |
| `lh hetero`        | -     | Run heterogeneous agent CLIs (Claude Code, Codex, etc.), stream their output       |
| `lh goal`          | -     | Run long-horizon Goal Graphs                                                       |
| `lh project`       | -     | Manage goal-oriented projects                                                      |
| `lh task`          | -     | Manage agent tasks (assignees, checkpoints, deps, review)                          |
| `lh thread`        | -     | Manage message threads                                                             |
| `lh trace`         | -     | Inspect and replay recorded agent execution traces                                 |
| `lh verify`        | -     | Agent Run verification machinery — criteria, rubrics, per-run check plans          |
| `lh acceptance`    | -     | Delivery acceptances — the cross-round review loop (checks, feedback, decision)    |
| `lh eval`          | -     | Manage evaluation workflows and benchmarks                                         |
| `lh generate`      | `gen` | Content generation (text, image, video, tts, asr, download)                        |
| `lh doc`           | -     | Document CRUD, batch-create, parse, topic linking                                  |
| `lh file`          | -     | File list, view, delete, recent                                                    |
| `lh artifact`      | -     | Publish local HTML pages as artifacts                                              |
| `lh kb`            | -     | Knowledge base CRUD, folders, docs, upload, tree view                              |
| `lh memory`        | -     | User memory CRUD + extraction                                                      |
| `lh message`       | -     | Message list, search, delete, count, heatmap                                       |
| `lh topic`         | -     | Topic CRUD + search + recent                                                       |
| `lh notify`        | -     | Send a callback message to a topic and trigger the agent to process it             |
| `lh migrate`       | -     | Import data from external tools (OpenClaw, ChatGPT, Claude, etc.)                  |
| `lh bot`           | -     | Manage bot integrations (channels, access policies, messengers)                    |
| `lh skill`         | -     | Skill CRUD + import (GitHub/URL/market)                                            |
| `lh model`         | -     | Model CRUD, toggle, batch-toggle, clear                                            |
| `lh provider`      | -     | Provider CRUD, config, test, toggle                                                |
| `lh plugin`        | -     | Plugin install, uninstall, update                                                  |
| `lh search`        | -     | Global search across all types                                                     |
| `lh session-group` | -     | Manage agent session groups                                                        |
| `lh workspace`     | `ws`  | Workspace list, scope switch, members, invites, usage                              |
| `lh user`          | -     | Manage user account and settings                                                   |
| `lh whoami`        | -     | Current user info (including the resolved workspace scope)                         |
| `lh usage`         | -     | Monthly/daily usage statistics                                                     |
| `lh man`           | -     | Show a manual page for the CLI or a subcommand                                     |
| `lh completion`    | -     | Output shell completion script                                                     |
| `lh update`        | -     | Update the CLI to the latest published version                                     |

### Workspace Scope

Every command runs against one scope, resolved in this order:

1. an explicit `--workspace <id>` on the commands that take it
2. the `LOBEHUB_WORKSPACE_ID` env var
3. the scope persisted by `lh workspace use <id|slug>`
4. personal content (no workspace)

The persisted scope is bound to the account and server it was chosen under. If
either changes — a different `lh login`, a `--server` switch — it is ignored and
reported as stale rather than attaching a workspace header the new identity has
no membership in. `lh logout` clears it. `lh whoami` and `lh workspace current`
both print which of the four sources is in effect.

API-key auth carries no local account identity, so there is nothing to bind a
saved scope to — those callers pass `LOBEHUB_WORKSPACE_ID` instead.

## Adding a New Command

### 1. Create Command File

Create `apps/cli/src/commands/<name>.ts`:

```typescript
import type { Command } from 'commander';
import { getTrpcClient } from '../api/client';
import { outputJson, printTable, truncate } from '../utils/format';

export function register<Name>Command(program: Command) {
  const cmd = program.command('<name>').description('...');

  // Subcommands
  cmd
    .command('list')
    .description('List items')
    .option('-L, --limit <n>', 'Maximum number of items', '30')
    .option('--json [fields]', 'Output JSON, optionally specify fields')
    .action(async (options) => {
      const client = await getTrpcClient();
      const result = await client.<router>.<procedure>.query({ ... });
      // Handle output
    });
}
```

### 2. Register in Entry Point

In `apps/cli/src/index.ts`:

```typescript
import { registerNewCommand } from './commands/new';
// ...
registerNewCommand(program);
```

### 3. Add Tests

Create `apps/cli/src/commands/<name>.test.ts` alongside the command file.

## Conventions

### Output Patterns

All list/view commands follow consistent patterns:

- `--json [fields]` - JSON output with optional field filtering
- `--yes` - Skip confirmation for destructive ops
- `-L, --limit <n>` - Pagination limit (default: 30)
- `-v, --verbose` - Verbose logging

### Table Output

```typescript
const rows = items.map((item) => [item.id, truncate(item.title, 40), timeAgo(item.updatedAt)]);
printTable(rows, ['ID', 'TITLE', 'UPDATED']);
```

### JSON Output

```typescript
if (options.json !== undefined) {
  const fields = typeof options.json === 'string' ? options.json : undefined;
  outputJson(items, fields);
  return;
}
```

### Authentication

Commands that need auth use `getTrpcClient()` which auto-resolves tokens:

```typescript
const client = await getTrpcClient();
// client.router.procedure.query/mutate(...)
```

### Confirmation Prompts

```typescript
import { confirm } from '../utils/format';
if (!options.yes) {
  const ok = await confirm('Are you sure?');
  if (!ok) return;
}
```

## Storage Locations

| File          | Path                            | Purpose                                          |
| ------------- | ------------------------------- | ------------------------------------------------ |
| Credentials   | `~/.lobehub/credentials.json`   | Encrypted tokens (AES-256-GCM)                   |
| Settings      | `~/.lobehub/settings.json`      | Custom server/gateway URLs                       |
| Workspace     | `~/.lobehub/active-workspace`   | Active scope + the account/server it is bound to |
| Daemon PID    | `~/.lobehub/daemon.pid`         | Background process PID                           |
| Daemon Status | `~/.lobehub/daemon.status.json` | Connection status JSON                           |
| Daemon Log    | `~/.lobehub/daemon.log`         | Daemon output log                                |

The base directory (`~/.lobehub/`) can be overridden with the `LOBEHUB_CLI_HOME` env var (e.g. `LOBEHUB_CLI_HOME=.lobehub-dev` for dev mode isolation).

## Key Dependencies

- `commander` - CLI framework
- `@trpc/client` + `superjson` - Type-safe API client
- `@lobechat/device-gateway-client` - WebSocket gateway connection
- `@lobechat/local-file-shell` - Local shell/file tool execution
- `picocolors` - Terminal colors
- `ws` - WebSocket
- `diff` - Text diffing
- `fast-glob` - File pattern matching

## Development

### Running in Dev Mode

Dev mode uses `LOBEHUB_CLI_HOME=.lobehub-dev` to isolate credentials from the global `~/.lobehub/` directory, so dev and production configs never conflict.

```bash
# Run a command in dev mode (from apps/cli/)
cd apps/cli && bun run dev -- <command>

# This is equivalent to:
LOBEHUB_CLI_HOME=.lobehub-dev bun src/index.ts <command>
```

### Connecting to Local Dev Server

To test CLI against a local dev server (e.g. `localhost:3011`):

**Step 1: Start the local server**

```bash
# From cloud repo root
bun run dev
# Server starts on http://localhost:3011 (or configured port)
```

**Step 2: Login to local server via Device Code Flow**

```bash
cd apps/cli && bun run dev -- login --server http://localhost:3011
```

This will:

1. Call `POST http://localhost:3011/oidc/device/auth` to get a device code
2. Print a URL like `http://localhost:3011/oidc/device?user_code=XXXX-YYYY`
3. Open the URL in your browser — log in and authorize
4. Save credentials to `apps/cli/.lobehub-dev/credentials.json`
5. Save server URL to `apps/cli/.lobehub-dev/settings.json`

After login, all subsequent `bun run dev -- <command>` calls will use the local server.

**Step 3: Run commands against local server**

```bash
cd apps/cli && bun run dev -- task list
cd apps/cli && bun run dev -- task create -i "Test task" -n "My Task"
cd apps/cli && bun run dev -- agent list
```

**Troubleshooting:**

- If login returns `invalid_grant`, make sure the local OIDC provider is properly configured (check `OIDC_*` env vars in `.env`)
- If you get `UNAUTHORIZED` on API calls, your token may have expired — run `bun run dev -- login --server http://localhost:3011` again
- Dev credentials are stored in `apps/cli/.lobehub-dev/` (gitignored), not in `~/.lobehub/`

### Switching Between Local and Production

```bash
# Dev mode (local server) — uses .lobehub-dev/
cd apps/cli && bun run dev -- <command>

# Production (app.lobehub.com) — uses ~/.lobehub/
lh <command>
```

The two environments are completely isolated by different credential directories.

### Build & Test

```bash
# Build CLI
cd apps/cli && bun run build

# Unit tests
cd apps/cli && bun run test

# E2E tests (requires authenticated CLI)
cd apps/cli && bunx vitest run e2e/kb.e2e.test.ts

# Link globally for testing (installs lh/lobe/lobehub commands)
cd apps/cli && bun run cli:link
```

## Detailed Command References

See `references/` for each command group:

- **Agent**: `references/agent.md` (CRUD, run, status)
- **Content Generation**: `references/generate.md` (text, image, video, tts, asr, download)
- **Knowledge & Files**: `references/knowledge.md` (kb, file, doc)
- **Conversation**: `references/conversation.md` (topic, message)
- **Memory**: `references/memory.md` (memory management, extraction)
- **Skills & Plugins**: `references/skills-plugins.md` (skill, plugin)
- **Models & Providers**: `references/models-providers.md` (model, provider)
- **Search & Config**: `references/search-config.md` (search, whoami, usage, workspace)
