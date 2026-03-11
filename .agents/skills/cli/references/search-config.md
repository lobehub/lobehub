# Search & Configuration Commands

## Global Search (`lh search`)

Search across all LobeHub resource types.

**Source**: `apps/cli/src/commands/search.ts`

### `lh search <query>`

```bash
lh search "meeting notes" [-t [-L [--json [fields]] < type > ] < n > ]
```

| Option              | Description             | Default   |
| ------------------- | ----------------------- | --------- |
| `-t, --type <type>` | Filter by resource type | All types |
| `-L, --limit <n>`   | Results per type        | `10`      |

### Searchable Types

| Type             | Description                  |
| ---------------- | ---------------------------- |
| `agent`          | AI agents                    |
| `topic`          | Conversation topics          |
| `file`           | Uploaded files               |
| `folder`         | File folders                 |
| `message`        | Chat messages                |
| `page`           | Documents/pages              |
| `memory`         | User memories                |
| `mcp`            | MCP servers                  |
| `plugin`         | Installed plugins            |
| `communityAgent` | Community marketplace agents |
| `knowledgeBase`  | Knowledge bases              |

**Output**: Results grouped by type, showing ID, title/name, description.

---

## User Configuration (`lh whoami` / `lh usage`)

**Source**: `apps/cli/src/commands/config.ts`

### `lh whoami`

Display current authenticated user information.

```bash
lh whoami [--json [fields]]
```

**Displays**: Name, username, email, user ID, subscription plan.

### `lh usage`

Display usage statistics.

```bash
lh usage [--month [--daily] [--json [fields]] < YYYY-MM > ]
```

| Option              | Description    | Default                 |
| ------------------- | -------------- | ----------------------- |
| `--month <YYYY-MM>` | Month to query | Current month           |
| `--daily`           | Group by day   | `false` (monthly total) |

**Output**: Token usage, costs, and model breakdown for the specified period.

---

## Global Options

These options are available across most commands:

| Option            | Description                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `--json [fields]` | Output as JSON; optionally filter to specific fields (comma-separated) |
| `--yes`           | Skip confirmation prompts for destructive operations                   |
| `-L, --limit <n>` | Pagination limit for list commands                                     |
| `-v, --verbose`   | Enable verbose/debug logging                                           |
| `--help`          | Show command help                                                      |
| `--version`       | Show CLI version                                                       |

### JSON Field Filtering

The `--json` option supports field selection:

```bash
# Full JSON output
lh agent list --json

# Only specific fields
lh agent list --json "id,title,model"
```
