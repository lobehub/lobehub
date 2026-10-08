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

Start an agent execution. Streams over the agent gateway WebSocket.

```bash
lh agent run [-a <id>] [-s <slug>] [-p <text>] [-t <id>] [--no-auto-start] [--device <target>] [--no-headless] [--json] [-v] [--replay <file>]
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

### Streaming Behavior

Uses `utils/agentStream.ts`. The agent gateway WebSocket delivers real-time notifications;
the authenticated `aiAgent.getOperationStreamHistory` API supplies the ordered event journal.
JWT and API-key authentication are supported. Reconnects refresh credentials and retry with
exponential backoff (up to six consecutive failures, capped at 15 seconds). A heartbeat
watchdog detects half-open sockets. History reads also check for a lost terminal notification.

The journal is replayed in exclusive-cursor pages on connection and reconnect, so output
is not duplicated or lost when the gateway buffer is trimmed or hibernated. JSON output
remains one array. Missing/truncated/expired history is an unknown outcome (exit 3), never
a successful recovery. Transport recovery does not restart the server-side run.

Self-hosted and local servers need a matching gateway configured with `AGENT_GATEWAY_URL`
on both the server and CLI, and a matching server-side gateway service token. The gateway
must trust the server's JWT signing key or support API-key verification against that server.

1. Sends agent run request to backend, receiving an `operationId`
2. Connects to the gateway WebSocket and streams events in real-time
3. Displays: text chunks, tool call status, operation progress
4. Shows final token usage and cost summary

Task `start --follow`, `run --follow`, and `run --topics N` use the same WebSocket
transport. Each topic waits for completion before the next begins. A failed stream
stops the sequence without sending a completion heartbeat or starting another topic.
Full history recovery is available within the server stream's existing two-hour inactivity
retention window (each publish renews it). Streams are no longer trimmed at 1,000 events.
This is temporary Redis retention, not permanent archival storage; it increases Redis
memory requirements. Existing pre-deploy streams with a trimmed prefix cannot be recovered.

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
