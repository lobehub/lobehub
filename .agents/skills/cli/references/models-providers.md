# Model & Provider Commands

## Model Management (`lh model`)

Manage AI models within providers.

**Source**: `apps/cli/src/commands/model.ts`

### `lh model list <providerId>`

List models for a specific provider.

```bash
lh model list openai [-L [--enabled] [--json [fields]] < n > ]
```

| Option            | Description              | Default |
| ----------------- | ------------------------ | ------- |
| `-L, --limit <n>` | Maximum items            | `50`    |
| `--enabled`       | Only show enabled models | `false` |

**Table columns**: ID, NAME, ENABLED, TYPE

### `lh model view <id>`

```bash
lh model view [fields]] < modelId > [--json
```

**Displays**: Name, provider, type, enabled status, capabilities.

### `lh model toggle <id>`

Enable or disable a model.

```bash
lh model toggle < modelId > --provider < providerId > --enable
lh model toggle < modelId > --provider < providerId > --disable
```

| Option                    | Description       | Required     |
| ------------------------- | ----------------- | ------------ |
| `--provider <providerId>` | Provider ID       | Yes          |
| `--enable`                | Enable the model  | One required |
| `--disable`               | Disable the model | One required |

### `lh model delete <id>`

```bash
lh model delete < modelId > --provider < providerId > [--yes]
```

| Option                    | Description       | Required |
| ------------------------- | ----------------- | -------- |
| `--provider <providerId>` | Provider ID       | Yes      |
| `--yes`                   | Skip confirmation | No       |

---

## Provider Management (`lh provider`)

Manage AI service providers.

**Source**: `apps/cli/src/commands/provider.ts`

### `lh provider list`

```bash
lh provider list [--json [fields]]
```

**Table columns**: ID, NAME, ENABLED, SOURCE

### `lh provider view <id>`

```bash
lh provider view [fields]] < providerId > [--json
```

**Displays**: Name, enabled status, source, configuration.

### `lh provider toggle <id>`

```bash
lh provider toggle < providerId > --enable
lh provider toggle < providerId > --disable
```

### `lh provider delete <id>`

```bash
lh provider delete < providerId > [--yes]
```
