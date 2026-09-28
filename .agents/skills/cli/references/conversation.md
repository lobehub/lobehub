# Conversation Commands (Topic & Message)

## Topic Management (`lh topic`)

Manage conversation topics (threads).

**Source**: `apps/cli/src/commands/topic.ts`

### `lh topic list`

```bash
lh topic list [--agent-id <id>] [-L <n>] [-P <n>] [--json [fields]]
```

| Option            | Description     | Default |
| ----------------- | --------------- | ------- |
| `--agent-id <id>` | Filter by agent | -       |
| `-L, --limit <n>` | Page size       | `30`    |
| `-P, --page <n>`  | Page number     | `1`     |

**Table columns**: ID, TITLE, FAV, UPDATED

### `lh topic search <keywords>`

```bash
lh topic search <keywords> [--agent-id <id>] [--json [fields]]
```

### `lh topic create`

```bash
lh topic create -t <title> [--agent-id <id>] [--favorite]
```

| Option                | Description          | Required |
| --------------------- | -------------------- | -------- |
| `-t, --title <title>` | Topic title          | Yes      |
| `--agent-id <id>`     | Associate with agent | No       |
| `--favorite`          | Mark as favorite     | No       |

### `lh topic edit <id>`

```bash
lh topic edit <id> [-t <title>] [--favorite] [--no-favorite]
```

### `lh topic delete [ids...]`

IDs may be passed as arguments, read from a file with `-f, --file <path>` (one per line, or a
JSON array), or both combined; at least one ID must resolve or the command errors.

```bash
lh topic delete [id1] [id2...] [-f <path>] [--yes]
```

### `lh topic recent`

```bash
lh topic recent [-L <n>] [--json [fields]]
```

| Option            | Description     | Default |
| ----------------- | --------------- | ------- |
| `-L, --limit <n>` | Number of items | `10`    |

---

## Message Management (`lh message`)

Manage chat messages within topics.

**Source**: `apps/cli/src/commands/message.ts`

### `lh message list`

```bash
lh message list [--topic-id <id>] [--agent-id <id>] [--role <role>] [--start <date>] [--end <date>] [-L <n>] [-P <n>] [--user] [--json [fields]]
```

| Option            | Description                                    | Default |
| ----------------- | ---------------------------------------------- | ------- |
| `--topic-id <id>` | Filter by topic                                | -       |
| `--agent-id <id>` | Filter by agent                                | -       |
| `--role <role>`   | Filter by role (user, assistant, tool, system) | -       |
| `--start <date>`  | Only messages created at/after this date       | -       |
| `--end <date>`    | Only messages created at/before this date      | -       |
| `-L, --limit <n>` | Page size                                      | `50`    |
| `-P, --page <n>`  | Page number                                    | `1`     |
| `--user`          | Shorthand for `--role user`                    | -       |

**Table columns**: ID, ROLE, AGENT, CONTENT, TOPIC/THREAD, CREATED

**Note**: Always queries via `message.listAll`.

### `lh message search <keywords>`

```bash
lh message search <keywords> [--json [fields]]
```

Full-text search across all messages.

### `lh message delete <ids...>`

```bash
lh message delete <id1> [id2...] [--yes]
```

### `lh message count`

```bash
lh message count [--topic-id <id>] [--agent-id <id>] [--role <role>] [--start <date>] [--end <date>] [--group-by <field>] [--json]
```

| Option               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `--topic-id <id>`    | Filter by topic                                  |
| `--agent-id <id>`    | Filter by agent                                  |
| `--role <role>`      | Filter by role (user, assistant, system)         |
| `--start <date>`     | Start date (ISO format, e.g. `2024-01-01`)       |
| `--end <date>`       | End date (ISO format)                            |
| `--group-by <field>` | Group counts by field; only `topic` is supported |

**Output**: Total message count for the specified period, or a per-topic breakdown table with
`--group-by topic`.

### `lh message heatmap`

```bash
lh message heatmap [--json]
```

**Output**: Activity heatmap data showing message frequency over time.
