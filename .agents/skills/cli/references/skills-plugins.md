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

### `lh skill install <source>` (alias: `lh skill i`)

Install a skill. Auto-detects source type from the input:

```bash
# GitHub (URL or owner/repo shorthand)
lh skill install lobehub/skill-repo
lh skill install https://github.com/lobehub/skill-repo
lh skill install lobehub/skill-repo --branch dev

# ZIP URL
lh skill install https://example.com/skill.zip

# Marketplace identifier
lh skill install my-cool-skill
lh skill i my-cool-skill
```

| Option              | Description               | Notes    |
| ------------------- | ------------------------- | -------- |
| `--branch <branch>` | Branch name (GitHub only) | Optional |

**Detection rules**:

- `https://github.com/...` or `owner/repo` → GitHub
- Other `https://...` URLs → ZIP URL
- Everything else → marketplace identifier

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
