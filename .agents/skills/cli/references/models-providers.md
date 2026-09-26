# Model & Provider Commands

## Model Management (`lh model`)

Manage AI models within providers.

**Source**: `apps/cli/src/commands/model.ts`

### `lh model list <providerId>`

List models for a specific provider.

```bash
lh model list openai
lh model list openai --type image --enabled
lh model list lobehub --type video --json
```

| Option            | Description                                                                            | Default |
| ----------------- | -------------------------------------------------------------------------------------- | ------- |
| `-L, --limit <n>` | Maximum items                                                                          | `50`    |
| `--enabled`       | Only show enabled models                                                               | `false` |
| `--type <type>`   | Filter by model type (`chat\|embedding\|tts\|asr\|image\|video\|text2music\|realtime`) | -       |
| `--json [fields]` | Output JSON, optionally specify fields                                                 | -       |

**Table columns**: ID, NAME, ENABLED, TYPE

**Backend**: `aiModel.getAiProviderModelList` → `AiInfraRepos.getAiProviderModelList` (supports `type` filter at repository level)

### `lh model view <id>`

```text
lh model view <id> [--json [fields]]
```

**Displays**: Name, provider, type, enabled status, capabilities.

### `lh model create`

```text
lh model create --id <id> --provider <providerId> [--display-name <name>] [--type <type>]
```

| Option                    | Description  | Default  |
| ------------------------- | ------------ | -------- |
| `--id <id>`               | Model ID     | Required |
| `--provider <providerId>` | Provider ID  | Required |
| `--display-name <name>`   | Display name | -        |
| `--type <type>`           | Model type   | `chat`   |

### `lh model edit <id>`

```text
lh model edit <id> --provider <providerId> [--display-name <name>] [--type <type>]
```

### `lh model toggle <id>`

Enable or disable a model.

```text
lh model toggle <id> --provider <providerId> --enable
lh model toggle <id> --provider <providerId> --disable
```

| Option                    | Description       | Required     |
| ------------------------- | ----------------- | ------------ |
| `--provider <providerId>` | Provider ID       | Yes          |
| `--enable`                | Enable the model  | One required |
| `--disable`               | Disable the model | One required |

### `lh model batch-toggle <ids...>`

Enable or disable multiple models at once.

```bash
lh model batch-toggle model1 model2 model3 --provider openai --enable
```

### `lh model delete <id>`

```text
lh model delete <id> --provider <providerId> [--yes]
```

### `lh model clear`

Clear all models (or only remote/fetched models) for a provider.

```text
lh model clear --provider <providerId> [--remote] [--yes]
```

---

## Provider Management (`lh provider`)

Manage AI service providers.

**Source**: `apps/cli/src/commands/provider.ts`

### `lh provider list`

```text
lh provider list [--json [fields]]
```

**Table columns**: ID, NAME, ENABLED, SOURCE

### `lh provider view <id>`

```text
lh provider view <id> [--json [fields]]
```

**Displays**: Name, enabled status, source, configuration.

### `lh provider create`

```text
lh provider create --id <id> -n <name> [-s <source>] [-d <desc>] [--logo <url>] [--sdk-type <type>]
```

| Option                     | Description                                       | Default  |
| -------------------------- | ------------------------------------------------- | -------- |
| `--id <id>`                | Provider ID                                       | Required |
| `-n, --name <name>`        | Provider name                                     | Required |
| `-s, --source <source>`    | Source type (`builtin` or `custom`)               | `custom` |
| `-d, --description <desc>` | Provider description                              | -        |
| `--logo <logo>`            | Provider logo URL                                 | -        |
| `--sdk-type <sdkType>`     | SDK type (openai, anthropic, azure, bedrock, ...) | -        |

### `lh provider edit <id>`

```text
lh provider edit <id> [-n <name>] [-d <desc>] [--logo <url>] [--sdk-type <type>]
```

Requires at least one change flag.

### `lh provider config <id>`

Configure provider settings (API key, base URL, etc.).

```bash
lh provider config openai --api-key sk-xxx
lh provider config openai --base-url https://custom-endpoint.com
lh provider config openai --show
lh provider config openai --show --json
```

| Option                   | Description                       |
| ------------------------ | --------------------------------- |
| `--api-key <key>`        | Set API key                       |
| `--base-url <url>`       | Set base URL                      |
| `--check-model <model>`  | Set connectivity check model      |
| `--enable-response-api`  | Enable Response API mode (OpenAI) |
| `--disable-response-api` | Disable Response API mode         |
| `--fetch-on-client`      | Enable fetching models on client  |
| `--no-fetch-on-client`   | Disable fetching models on client |
| `--show`                 | Show current config               |
| `--json [fields]`        | Output JSON (with --show)         |

**Important**: The `lobehub` provider is platform-managed. Attempting to set `--api-key` or `--base-url` on it will be rejected with an error message.

### `lh provider test <id>`

Test provider connectivity.

```bash
lh provider test openai
lh provider test openai -m gpt-4o --json
```

### `lh provider toggle <id>`

```text
lh provider toggle <id> --enable
lh provider toggle <id> --disable
```

### `lh provider delete <id>`

```text
lh provider delete <id> [--yes]
```
