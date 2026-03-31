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
| `--type <type>`   | Filter by model type (`chat\|embedding\|tts\|stt\|image\|video\|text2music\|realtime`) | -       |
| `--json [fields]` | Output JSON, optionally specify fields                                                 | -       |

**Table columns**: ID, NAME, ENABLED, TYPE

**Backend**: `aiModel.getAiProviderModelList` → `AiInfraRepos.getAiProviderModelList` (supports `type` filter at repository level)

### `lh model view <id>`

```bash
lh model view [fields]] < modelId > [--json
```

**Displays**: Name, provider, type, enabled status, capabilities.

### `lh model create`

```bash
lh model create --id [--type < id > --provider < providerId > [--display-name < name > ] < type > ]
```

| Option                    | Description  | Default  |
| ------------------------- | ------------ | -------- |
| `--id <id>`               | Model ID     | Required |
| `--provider <providerId>` | Provider ID  | Required |
| `--display-name <name>`   | Display name | -        |
| `--type <type>`           | Model type   | `chat`   |

### `lh model edit <id>`

```bash
lh model edit [--type < modelId > --provider < providerId > [--display-name < name > ] < type > ]
```

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

### `lh model batch-toggle <ids...>`

Enable or disable multiple models at once.

```bash
lh model batch-toggle model1 model2 model3 --provider openai --enable
```

### `lh model delete <id>`

```bash
lh model delete < modelId > --provider < providerId > [--yes]
```

### `lh model clear`

Clear all models (or only remote/fetched models) for a provider.

```bash
lh model clear --provider [--yes] < providerId > [--remote]
```

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

### `lh provider create`

```bash
lh provider create --id [-d [--logo [--sdk-type < id > -n < name > [-s < source > ] < desc > ] < url > ] < type > ]
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

```bash
lh provider edit [-d [--logo [--sdk-type < providerId > [-n < name > ] < desc > ] < url > ] < type > ]
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

```bash
lh provider toggle < providerId > --enable
lh provider toggle < providerId > --disable
```

### `lh provider delete <id>`

```bash
lh provider delete < providerId > [--yes]
```
