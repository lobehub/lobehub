# Memory Commands

Manage user memories - the AI's long-term knowledge about users.

**Source**: `apps/cli/src/commands/memory.ts`

## Memory Categories

| Category     | Description                               |
| ------------ | ----------------------------------------- |
| `identity`   | User's name, role, relationships          |
| `activity`   | Recent activities and their status        |
| `context`    | Ongoing contexts, projects, goals         |
| `experience` | Past experiences and key learnings        |
| `preference` | User preferences, directives, suggestions |

---

## `lh memory list [category]`

List memory entries, optionally filtered by category.

```bash
lh memory list            # All categories
lh memory list identity   # Only identity memories
lh memory list preference # Only preferences
```

| Option            | Description |
| ----------------- | ----------- |
| `--json [fields]` | JSON output |

**Output**: Grouped by category, showing type/status and descriptions.

---

## `lh memory create`

Create a new identity memory entry.

```bash
lh memory create [options]
```

| Option                     | Description              |
| -------------------------- | ------------------------ |
| `--type <type>`            | Memory type              |
| `--role <role>`            | User's role              |
| `--relationship <rel>`     | Relationship description |
| `-d, --description <desc>` | Description              |
| `--labels <labels...>`     | Extracted labels         |

---

## `lh memory edit <category> <id>`

Edit a memory entry. Options vary by category:

```bash
lh memory edit identity < id > [options]
lh memory edit activity < id > [options]
lh memory edit context < id > [options]
lh memory edit experience < id > [options]
lh memory edit preference < id > [options]
```

### Category-specific Options

**identity**:

- `--type <type>`, `--role <role>`, `--relationship <rel>`

**activity**:

- `--narrative <text>`, `--notes <text>`, `--status <status>`

**context**:

- `--title <title>`, `--description <desc>`, `--status <status>`

**experience**:

- `--situation <text>`, `--action <text>`, `--key-learning <text>`

**preference**:

- `--directives <text>`, `--suggestions <text>`

---

## `lh memory delete <category> <id>`

```bash
lh memory delete identity < id > [--yes]
```

---

## `lh memory persona`

Display the compiled memory persona summary.

```bash
lh memory persona [--json [fields]]
```

**Output**: Summarized user profile built from all memory categories.

---

## `lh memory extract`

Trigger async memory extraction from chat history.

```bash
lh memory extract [--from [--to < date > ] < date > ]
```

| Option          | Description             |
| --------------- | ----------------------- |
| `--from <date>` | Start date (ISO format) |
| `--to <date>`   | End date (ISO format)   |

Starts a background task that analyzes chat history and creates new memory entries.

---

## `lh memory extract-status`

Check the status of a memory extraction task.

```bash
lh memory extract-status [--task-id [--json [fields]] < id > ]
```

| Option           | Description         |
| ---------------- | ------------------- |
| `--task-id <id>` | Check specific task |
