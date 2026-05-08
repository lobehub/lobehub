const content = `# lh model - AI Model Management

Manage AI models for providers.

## Subcommands

- \`lh model list <providerId> [--enabled] [--type <type>] [-L <limit>]\` - List models
- \`lh model view <id>\` - View model details
- \`lh model create --id <id> --provider <p> --display-name <name> [--type <type>]\` - Create model
- \`lh model edit <id> [--provider <p>] [--display-name <name>]\` - Update model
- \`lh model toggle <id> --provider <p> [--enable|--disable]\` - Enable/disable model
- \`lh model delete <id> --provider <p> [--yes]\` - Delete model
- \`lh model batch-toggle <ids...> --provider <p> [--enable|--disable]\` - Batch toggle
- \`lh model clear --provider <p> [--remote] [--yes]\` - Clear all models for provider

## Model Types

The \`--type\` filter accepts the following values:

| Type | Description |
|------|-------------|
| \`chat\` | Text chat / LLM models |
| \`embedding\` | Text embedding models |
| \`tts\` | Text-to-speech models |
| \`stt\` | Speech-to-text models |
| \`image\` | Image generation models |
| \`video\` | Video generation models |
| \`text2music\` | Music generation models |
| \`realtime\` | Realtime audio/video models |

## Tips

- Models belong to providers; always specify \`--provider\` when needed
- \`lh model list\` without \`--type\` returns all model types; use \`--type video\` (or the relevant type) to narrow results when looking for non-chat models
- Use \`--enabled\` to filter only active models
`;

export default content;
