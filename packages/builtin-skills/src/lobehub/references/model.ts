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

## Tips

- Models belong to providers; always specify \`--provider\` when needed
- Use \`--type\` to filter by model type (chat, embedding, etc.)
`;

export default content;
