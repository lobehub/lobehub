# Skill & Plugin Commands

## Skill Management (`lh skill`)

Manage agent skills (custom instructions and capabilities).

**Source**: `apps/cli/src/commands/skill.ts`

### `lh skill list`

```bash
lh skill list [--source [--json [fields]] < source > ]
```

| Option              | Description                         |
| ------------------- | ----------------------------------- |
| `--source <source>` | Filter: `builtin`, `market`, `user` |

**Table columns**: ID, NAME, DESCRIPTION, SOURCE, IDENTIFIER

### `lh skill view <id>`

```bash
lh skill view [fields]] < id > [--json
```

**Displays**: Name, description, source, identifier, content.

### `lh skill create`

```bash
lh skill create -n < name > -d < desc > -c < content > [-i < identifier > ]
```

| Option                     | Description                         | Required |
| -------------------------- | ----------------------------------- | -------- |
| `-n, --name <name>`        | Skill name                          | Yes      |
| `-d, --description <desc>` | Description                         | Yes      |
| `-c, --content <content>`  | Skill content (prompt/instructions) | Yes      |
| `-i, --identifier <id>`    | Custom identifier                   | No       |

### `lh skill edit <id>`

```bash
lh skill edit [-n [-d < id > [-c < content > ] < name > ] < desc > ]
```

### `lh skill delete <id>`

```bash
lh skill delete < id > [--yes]
```

### `lh skill search <query>`

```bash
lh skill search [fields]] < query > [--json
```

### Import Commands

#### `lh skill import-github`

Import a skill from a GitHub repository.

```bash
lh skill import-github --url < gitUrl > [--branch < branch > ]
```

| Option              | Description        | Required            |
| ------------------- | ------------------ | ------------------- |
| `--url <gitUrl>`    | Git repository URL | Yes                 |
| `--branch <branch>` | Branch name        | No (default branch) |

#### `lh skill import-url`

Import a skill from a ZIP file URL.

```bash
lh skill import-url --url <zipUrl>
```

#### `lh skill import-market`

Import a skill from the LobeHub skill marketplace.

```bash
lh skill import-market -i <identifier>
```

### Resource Commands

#### `lh skill resources <id>`

List files/resources within a skill.

```bash
lh skill resources [fields]] < id > [--json
```

**Displays**: Path, type, size.

#### `lh skill read-resource <id> <path>`

Read a specific resource file from a skill.

```bash
lh skill read-resource <skillId> <path>
```

**Output**: File content or JSON metadata.

---

## Plugin Management (`lh plugin`)

Install and manage plugins (external tool integrations).

**Source**: `apps/cli/src/commands/plugin.ts`

### `lh plugin list`

```bash
lh plugin list [--json [fields]]
```

**Table columns**: ID, IDENTIFIER, TYPE, TITLE

### `lh plugin install`

```bash
lh plugin install -i [--settings < identifier > --manifest < json > [--type < type > ] < json > ]
```

| Option                  | Description                | Required               |
| ----------------------- | -------------------------- | ---------------------- |
| `-i, --identifier <id>` | Plugin identifier          | Yes                    |
| `--manifest <json>`     | Plugin manifest JSON       | Yes                    |
| `--type <type>`         | `plugin` or `customPlugin` | No (default: `plugin`) |
| `--settings <json>`     | Plugin settings JSON       | No                     |

### `lh plugin uninstall <id>`

```bash
lh plugin uninstall < id > [--yes]
```

### `lh plugin update <id>`

```bash
lh plugin update [--settings < id > [--manifest < json > ] < json > ]
```
