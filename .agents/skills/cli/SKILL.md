---
name: cli
description: LobeHub CLI (@lobehub/cli) development guide. Use when working on CLI commands, adding new subcommands, fixing CLI bugs, or understanding CLI architecture. Triggers on CLI development, command implementation, or `lh` command questions.
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
├── index.ts                  # Entry point, registers all commands
├── api/
│   ├── client.ts             # tRPC client (type-safe backend API)
│   └── http.ts               # Raw HTTP utilities
├── auth/
│   ├── credentials.ts        # Encrypted credential storage (AES-256-GCM)
│   ├── refresh.ts            # Token auto-refresh
│   └── resolveToken.ts       # Token resolution (flag > stored)
├── commands/                 # All CLI commands (one file per command group)
│   ├── agent.ts              # Agent CRUD + run
│   ├── config.ts             # whoami, usage
│   ├── connect.ts            # Device gateway connection + daemon
│   ├── doc.ts                # Document management
│   ├── file.ts               # File management
│   ├── generate/             # Content generation (text/image/video/tts/asr)
│   ├── kb.ts                 # Knowledge base management
│   ├── login.ts              # OIDC Device Code Flow auth
│   ├── logout.ts             # Clear credentials
│   ├── memory.ts             # User memory management
│   ├── message.ts            # Message management
│   ├── model.ts              # AI model management
│   ├── plugin.ts             # Plugin management
│   ├── provider.ts           # AI provider management
│   ├── search.ts             # Global search
│   ├── skill.ts              # Agent skill management
│   ├── status.ts             # Gateway connectivity check
│   └── topic.ts              # Conversation topic management
├── daemon/
│   └── manager.ts            # Background daemon process management
├── tools/
│   ├── shell.ts              # Shell command execution (for gateway)
│   └── file.ts               # File operations (for gateway)
├── settings/
│   └── index.ts              # Persistent settings (~/.lobehub/)
├── utils/
│   ├── logger.ts             # Logging (verbose mode)
│   ├── format.ts             # Table output, JSON, timeAgo, truncate
│   └── agentStream.ts        # SSE streaming for agent runs
└── constants/
    └── urls.ts               # Official server & gateway URLs
```

## Command Groups

| Command       | Alias | Description                                                 |
| ------------- | ----- | ----------------------------------------------------------- |
| `lh login`    | -     | Authenticate via OIDC Device Code Flow                      |
| `lh logout`   | -     | Clear stored credentials                                    |
| `lh connect`  | -     | Device gateway connection & daemon management               |
| `lh status`   | -     | Quick gateway connectivity check                            |
| `lh agent`    | -     | Agent CRUD, run, status                                     |
| `lh generate` | `gen` | Content generation (text, image, video, tts, asr, download) |
| `lh doc`      | -     | Document CRUD, batch-create, parse, topic linking           |
| `lh file`     | -     | File list, view, delete, recent                             |
| `lh kb`       | -     | Knowledge base CRUD, folders, docs, upload, tree view       |
| `lh memory`   | -     | User memory CRUD + extraction                               |
| `lh message`  | -     | Message list, search, delete, count, heatmap                |
| `lh topic`    | -     | Topic CRUD + search + recent                                |
| `lh skill`    | -     | Skill CRUD + import (GitHub/URL/market)                     |
| `lh model`    | -     | Model CRUD, toggle, batch-toggle, clear                     |
| `lh provider` | -     | Provider CRUD, config, test, toggle                         |
| `lh plugin`   | -     | Plugin install, uninstall, update                           |
| `lh search`   | -     | Global search across all types                              |
| `lh whoami`   | -     | Current user info                                           |
| `lh usage`    | -     | Monthly/daily usage statistics                              |

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

| File          | Path                          | Purpose                        |
| ------------- | ----------------------------- | ------------------------------ |
| Credentials   | `~/.lobehub/credentials.json` | Encrypted tokens (AES-256-GCM) |
| Settings      | `~/.lobehub/settings.json`    | Custom server/gateway URLs     |
| Daemon PID    | `~/.lobehub/daemon.pid`       | Background process PID         |
| Daemon Status | `~/.lobehub/daemon.status`    | Connection status JSON         |
| Daemon Log    | `~/.lobehub/daemon.log`       | Daemon output log              |

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
- **Search & Config**: `references/search-config.md` (search, whoami, usage)
