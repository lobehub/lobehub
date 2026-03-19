# Conversation Commands (Topic & Message)

## Topic Management (`lh topic`)

Manage conversation topics (threads).

**Source**: `apps/cli/src/commands/topic.ts`

### `lh topic list`

```bash
lh topic list [--agent-id [-L [--page [--json [fields]] < id > ] < n > ] < n > ]
```

| Option            | Description     | Default |
| ----------------- | --------------- | ------- |
| `--agent-id <id>` | Filter by agent | -       |
| `-L, --limit <n>` | Page size       | `30`    |
| `--page <n>`      | Page number     | `1`     |

**Table columns**: ID, TITLE, FAV, UPDATED

### `lh topic search <keywords>`

```bash
lh topic search [--json [fields]] < keywords > [--agent-id < id > ]
```

### `lh topic create`

```bash
lh topic create -t [--favorite] < title > [--agent-id < id > ]
```

| Option                | Description          | Required |
| --------------------- | -------------------- | -------- |
| `-t, --title <title>` | Topic title          | Yes      |
| `--agent-id <id>`     | Associate with agent | No       |
| `--favorite`          | Mark as favorite     | No       |

### `lh topic edit <id>`

```bash
lh topic edit [--favorite] [--no-favorite] < id > [-t < title > ]
```

### `lh topic delete <ids...>`

```bash
lh topic delete [--yes] < id1 > [id2...]
```

### `lh topic recent`

```bash
lh topic recent [-L [--json [fields]] < n > ]
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
lh message list [options] [--json [fields]]
```

| Option            | Description             | Default |
| ----------------- | ----------------------- | ------- |
| `--topic-id <id>` | Filter by topic         | -       |
| `--agent-id <id>` | Filter by agent         | -       |
| `-L, --limit <n>` | Page size               | `30`    |
| `--page <n>`      | Page number             | `1`     |
| `--user`          | Only show user messages | -       |

**Table columns**: ID, ROLE, CONTENT, CREATED

**Note**: When `--topic-id` or `--agent-id` is provided, uses `message.getMessages`; otherwise uses `message.listAll`.

### `lh message search <keywords>`

```bash
lh message search [fields]] < keywords > [--json
```

Full-text search across all messages.

### `lh message delete <ids...>`

```bash
lh message delete [--yes] < id1 > [id2...]
```

### `lh message count`

```bash
lh message count [--start [--end [--json] < date > ] < date > ]
```

| Option           | Description                                |
| ---------------- | ------------------------------------------ |
| `--start <date>` | Start date (ISO format, e.g. `2024-01-01`) |
| `--end <date>`   | End date (ISO format)                      |

**Output**: Total message count for the specified period.

### `lh message heatmap`

```bash
lh message heatmap [--json]
```

**Output**: Activity heatmap data showing message frequency over time.
