# Search & Configuration Commands

## Global Search (`lh search`)

Search across local resources, or the web with `--web`.

**Source**: `apps/cli/src/commands/search.ts`

### `lh search`

`-q, --query` is not a positional argument — it's an option. If omitted, the command prints help
and exits instead of erroring.

```text
lh search -q <query> [-w] [-t <type>] [-L <n>] [-e <engines>] [-c <categories>] [-T <range>] [--json [fields]]
```

```bash
lh search -q "meeting notes"
lh search -q "latest AI news" --web
```

| Option                          | Description                                                       | Default   |
| ------------------------------- | ----------------------------------------------------------------- | --------- |
| `-q, --query <query>`           | Search query (required)                                           | -         |
| `-w, --web`                     | Search the web instead of local resources                         | `false`   |
| `-t, --type <type>`             | Filter by resource type (local search only)                       | All types |
| `-L, --limit <n>`               | Results per type (local search only)                              | `10`      |
| `-e, --engines <engines>`       | Web search engines (comma-separated, requires `--web`)            | -         |
| `-c, --categories <categories>` | Web search categories (comma-separated, requires `--web`)         | -         |
| `-T, --time-range <range>`      | Time range filter (e.g. day, week, month, year, requires `--web`) | -         |
| `--json [fields]`               | JSON output, optionally selecting fields                          | -         |

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

**Output**: Local search results grouped by type, showing ID, title/name, description. Web search
results are printed as a table of TITLE, URL, SCORE, CONTENT.

### `lh search view <target>`

View details of a single result: a URL crawls the page (web result); `type:id` (e.g.
`agent:abc123`) looks up a local resource.

```text
lh search view <target> [-i <impls>] [--json [fields]]
```

| Option               | Description                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `-i, --impl <impls>` | Crawler implementations for web URLs (comma-separated: browserless, exa, firecrawl, jina, naive, search1api, tavily) |

**Local view support**: only `agent`, `file`, and `knowledgeBase` types are implemented; other
`type:id` values error with "View not supported for type".

---

## User Configuration (`lh whoami` / `lh usage`)

**Source**: `apps/cli/src/commands/config.ts`

### `lh whoami`

Display current authenticated user information.

```text
lh whoami [--json [fields]]
```

**Displays**: Name, username, email, user ID, subscription plan.

### `lh usage`

Display usage statistics.

```text
lh usage [--month <YYYY-MM>] [--agent-id <id>] [--daily] [--json [fields]]
```

| Option              | Description               | Default                 |
| ------------------- | ------------------------- | ----------------------- |
| `--month <YYYY-MM>` | Month to query            | Current month           |
| `--agent-id <id>`   | Filter usage to one agent | All agents              |
| `--daily`           | Group by day              | `false` (monthly total) |

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
