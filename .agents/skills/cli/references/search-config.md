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

## Workspace (`lh workspace`)

Aliased `lh ws`. Workspace membership is a cloud feature; on an open-source
deployment these procedures answer empty or `NOT_IMPLEMENTED`.

### Scope

| Command                       | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `lh workspace current`        | Which scope commands run under, and where it came from |
| `lh workspace use <id\|slug>` | Persist the scope for subsequent commands              |
| `lh workspace use --personal` | Drop back to personal content                          |

Resolution order is `--workspace` → `LOBEHUB_WORKSPACE_ID` → the persisted scope
→ personal. Setting the persisted scope while `LOBEHUB_WORKSPACE_ID` is exported
prints a warning, because the env var still wins.

The persisted scope lives in `~/.lobehub/active-workspace` together with the
account (`sub` claim) and server URL it was chosen under. Switching account or
server invalidates it; `lh logout` deletes it. API-key auth has no local account
identity, so `workspace use` refuses to save under it — use the env var.

### Reads

| Command                    | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `lh workspace list`        | Workspaces you belong to; `*` marks the effective one |
| `lh workspace view [id]`   | Workspace detail                                      |
| `lh workspace settings`    | The workspace settings blob                           |
| `lh workspace stats`       | Content totals — admin only; `--mine` for your own    |
| `lh workspace usage`       | Credit spend by type for the billing window           |
| `lh workspace members`     | Members with role and email                           |
| `lh workspace invitations` | Pending invitations (admin)                           |
| `lh workspace audit-log`   | Audit entries (admin, Business plan)                  |

### Writes

| Command                             | Description                                     |
| ----------------------------------- | ----------------------------------------------- |
| `lh workspace create <name> --slug` | Create a workspace; `--use` switches into it    |
| `lh workspace update`               | Name / slug / description / avatar (admin)      |
| `lh workspace invite <email>`       | Invite a member, `--role admin\|member\|viewer` |

Slugs are 3–32 chars, lowercase alphanumerics with inner hyphens. Deleting a
workspace and removing members are deliberately not exposed here.

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
