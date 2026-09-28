# Skill & Plugin Commands

## Skill Management (`lh skill`)

Manage agent skills (custom instructions and capabilities).

**Source**: `apps/cli/src/commands/skill.ts`

### `lh skill list`

```bash
lh skill list [--source <source>] [--json [fields]]
```

| Option              | Description                         |
| ------------------- | ----------------------------------- |
| `--source <source>` | Filter: `builtin`, `market`, `user` |

**Table columns**: ID, NAME, DESCRIPTION, SOURCE, IDENTIFIER

### `lh skill view <id>`

```bash
lh skill view <id> [--json [fields]]
```

**Displays**: Name, description, source, identifier, content.

### `lh skill create`

```bash
lh skill create -n <name> -d <desc> -c <content> [-i <id>]
```

| Option                     | Description                         | Required |
| -------------------------- | ----------------------------------- | -------- |
| `-n, --name <name>`        | Skill name                          | Yes      |
| `-d, --description <desc>` | Description                         | Yes      |
| `-c, --content <content>`  | Skill content (prompt/instructions) | Yes      |
| `-i, --identifier <id>`    | Custom identifier                   | No       |

### `lh skill edit <id>`

Requires at least one of `-c`/`-n`/`-d`; errors if none specified.

```bash
lh skill edit <id> [-n <name>] [-d <desc>] [-c <content>]
```

### `lh skill delete <id>`

```bash
lh skill delete <id> [--yes]
```

### `lh skill search <query>`

```bash
lh skill search <query> [--json [fields]]
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
lh skill resources <id> [--json [fields]]
```

**Displays**: Path, type, size.

#### `lh skill read-resource <id> <path>`

Read a specific resource file from a skill.

```bash
lh skill read-resource <id> <path>
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
lh plugin install -i <id> --manifest <json> [--type <type>] [--settings <json>]
```

| Option                  | Description                | Required               |
| ----------------------- | -------------------------- | ---------------------- |
| `-i, --identifier <id>` | Plugin identifier          | Yes                    |
| `--manifest <json>`     | Plugin manifest JSON       | Yes                    |
| `--type <type>`         | `plugin` or `customPlugin` | No (default: `plugin`) |
| `--settings <json>`     | Plugin settings JSON       | No                     |

### `lh plugin uninstall <id>`

```bash
lh plugin uninstall <id> [--yes]
```

### `lh plugin update <id>`

Requires `--manifest` or `--settings` (at least one); errors if neither is specified.

```bash
lh plugin update <id> [--manifest <json>] [--settings <json>]
```
