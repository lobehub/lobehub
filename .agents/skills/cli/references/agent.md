# Agent Commands

Manage AI agents: create, edit, delete, list, run, and check status.

**Source**: `apps/cli/src/commands/agent.ts`

## `lh agent list`

List all agents.

```bash
lh agent list [-L [-k [--json [fields]] < n > ] < keyword > ]
```

| Option                    | Description                            | Default |
| ------------------------- | -------------------------------------- | ------- |
| `-L, --limit <n>`         | Maximum items                          | `30`    |
| `-k, --keyword <keyword>` | Filter by keyword                      | -       |
| `--json [fields]`         | JSON output with optional field filter | -       |

**Table columns**: ID, TITLE, DESCRIPTION, MODEL

---

## `lh agent view <agentId>`

View agent configuration details.

```bash
lh agent view [fields]] < agentId > [--json
```

**Displays**: Title, description, model, provider, system role, plugins, tools.

---

## `lh agent create`

Create a new agent.

```bash
lh agent create [options]
```

| Option                      | Description    | Required |
| --------------------------- | -------------- | -------- |
| `-t, --title <title>`       | Agent title    | No       |
| `-d, --description <desc>`  | Description    | No       |
| `-m, --model <model>`       | Model ID       | No       |
| `-p, --provider <provider>` | Provider ID    | No       |
| `-s, --system-role <role>`  | System prompt  | No       |
| `--group <groupId>`         | Agent group ID | No       |

**Output**: Created agent ID and session ID.

---

## `lh agent edit <agentId>`

Update an existing agent. Same options as `create`, all optional. Only specified fields are updated.

```bash
lh agent edit [-m [-s ... < agentId > [-t < title > ] < model > ] < role > ]
```

---

## `lh agent delete <agentId>`

Delete an agent.

```bash
lh agent delete < agentId > [--yes]
```

Requires confirmation unless `--yes` is provided.

---

## `lh agent duplicate <agentId>`

Duplicate an existing agent.

```bash
lh agent duplicate < agentId > [-t < title > ]
```

| Option                | Description                          |
| --------------------- | ------------------------------------ |
| `-t, --title <title>` | Optional new title for the duplicate |

**Output**: New agent ID.

---

## `lh agent run`

Start an agent execution (streaming SSE).

```bash
lh agent run [options]
```

| Option                | Description                                  |
| --------------------- | -------------------------------------------- |
| `-a, --agent-id <id>` | Agent ID to run                              |
| `-s, --slug <slug>`   | Agent slug (alternative to ID)               |
| `-p, --prompt <text>` | User prompt                                  |
| `-t, --topic-id <id>` | Reuse existing topic                         |
| `--no-auto-start`     | Don't auto-start the agent                   |
| `--json`              | Output full JSON event stream                |
| `-v, --verbose`       | Show detailed tool call info                 |
| `--replay <file>`     | Replay events from saved JSON file (offline) |

### Streaming Behavior

Uses `utils/agentStream.ts` to handle Server-Sent Events:

1. Sends agent run request to backend
2. Streams SSE events in real-time
3. Displays: text chunks, tool call status, operation progress
4. Shows final token usage and cost summary

### Replay Mode

`--replay <file>` reads a saved JSON event stream for offline debugging without server connection.

---

## `lh agent status <operationId>`

Check agent operation status.

```bash
lh agent status [fields]] [--history] [--history-limit < operationId > [--json < n > ]
```

| Option                | Description          | Default |
| --------------------- | -------------------- | ------- |
| `--json [fields]`     | JSON output          | -       |
| `--history`           | Include step history | `false` |
| `--history-limit <n>` | Max history entries  | `10`    |

**Displays**: Status (running/completed/failed), steps count, tokens used, cost, error info, timestamps.
