# Agent Commands

Manage AI agents: create, edit, delete, list, run, and check status.

**Source**: `apps/cli/src/commands/agent.ts`

## `lh agent list`

List all agents.

```bash
lh agent list [-L <n>] [-k <keyword>] [--json [fields]]
```

| Option                    | Description                            | Default |
| ------------------------- | -------------------------------------- | ------- |
| `-L, --limit <n>`         | Maximum items                          | `30`    |
| `-k, --keyword <keyword>` | Filter by keyword                      | -       |
| `--json [fields]`         | JSON output with optional field filter | -       |

**Table columns**: ID, TITLE, DESCRIPTION, MODEL

---

## `lh agent view [agentId]`

View agent configuration details. `agentId` may be omitted when `-s, --slug` is given instead.

```bash
lh agent view [agentId] [-s <slug>] [--json [fields]]
```

**Displays**: Title, description, model, provider, system role, plugins, tools.

---

## `lh agent create`

Create a new agent.

```bash
lh agent create [-t <title>] [-d <desc>] [-m <model>] [-p <provider>] [-s <role>] [--group <groupId>]
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

## `lh agent edit [agentId]`

Update an existing agent. `agentId` may be omitted when `--slug` is given instead (note: unlike
`create`/`view`, this flag has no `-s` short alias here because `-s` is used for `--system-role`).
Only specified fields are updated.

```bash
lh agent edit [agentId] [--slug <slug>] [-t <title>] [-d <desc>] [-m <model>] [-p <provider>] [-s <role>] [--graph-file <path>] [--enable-graph] [--disable-graph] [--agency-config-file <path>] [--config-file <path>] [--json [fields]]
```

| Option                        | Description                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--slug <slug>`               | Agent slug, alternative to `agentId`                                                                     |
| `-t, --title <title>`         | New title                                                                                                |
| `-d, --description <desc>`    | New description                                                                                          |
| `-m, --model <model>`         | New model ID                                                                                             |
| `-p, --provider <provider>`   | New provider ID                                                                                          |
| `-s, --system-role <role>`    | New system role prompt                                                                                   |
| `--graph-file <path>`         | AgentGraph JSON file                                                                                     |
| `--enable-graph`              | Enable graph runtime                                                                                     |
| `--disable-graph`             | Disable graph runtime                                                                                    |
| `--agency-config-file <path>` | `agencyConfig` JSON, deep-merged into the agent (send `null` to clear a nested key)                      |
| `--config-file <path>`        | Agent config JSON for fields without a dedicated flag; deep-merged server-side, identity fields rejected |
| `--json [fields]`             | Output the updated agent as JSON, optionally selecting fields                                            |

---

## `lh agent delete <agentId>`

Delete an agent.

```bash
lh agent delete <agentId> [--yes]
```

Requires confirmation unless `--yes` is provided.

---

## `lh agent duplicate <agentId>`

Duplicate an existing agent.

```bash
lh agent duplicate <agentId> [-t <title>]
```

| Option                | Description                          |
| --------------------- | ------------------------------------ |
| `-t, --title <title>` | Optional new title for the duplicate |

**Output**: New agent ID.

---

## `lh agent run`

Start an agent execution. Streams over the agent gateway WebSocket by default, or via SSE with
`--sse`.

```bash
lh agent run [-a <id>] [-s <slug>] [-p <text>] [-t <id>] [--no-auto-start] [--device <target>] [--no-headless] [--json] [-v] [--replay <file>] [--sse]
```

| Option                | Description                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `-a, --agent-id <id>` | Agent ID to run                                                                        |
| `-s, --slug <slug>`   | Agent slug (alternative to ID)                                                         |
| `-p, --prompt <text>` | User prompt                                                                            |
| `-t, --topic-id <id>` | Reuse existing topic                                                                   |
| `--no-auto-start`     | Don't auto-start the agent                                                             |
| `--device <target>`   | Target device ID, or `local` for the current connected device                          |
| `--no-headless`       | Wait for human approval on tool calls instead of auto-running them (default: headless) |
| `--json`              | Output full JSON event stream                                                          |
| `-v, --verbose`       | Show detailed tool call info                                                           |
| `--replay <file>`     | Replay events from saved JSON file (offline)                                           |
| `--sse`               | Force SSE stream instead of the WebSocket gateway                                      |

### Streaming Behavior

Uses `utils/agentStream.ts`. By default, streams over the agent gateway WebSocket; pass `--sse` to
force the legacy SSE endpoint instead. If the live stream drops before the run finishes, the CLI
falls back to polling `agent status` every 10 seconds until the run reaches a terminal state.

1. Sends agent run request to backend, receiving an `operationId`
2. Connects to the gateway WebSocket (or SSE endpoint with `--sse`) and streams events in real-time
3. Displays: text chunks, tool call status, operation progress
4. Shows final token usage and cost summary

### Replay Mode

`--replay <file>` reads a saved JSON event stream for offline debugging without server connection.

---

## `lh agent status <operationId>`

Check agent operation status.

```bash
lh agent status <operationId> [--json [fields]] [--history] [--history-limit <n>]
```

| Option                | Description          | Default |
| --------------------- | -------------------- | ------- |
| `--json [fields]`     | JSON output          | -       |
| `--history`           | Include step history | `false` |
| `--history-limit <n>` | Max history entries  | `10`    |

**Displays**: Status (running/completed/failed), steps count, tokens used, cost, error info, timestamps.
