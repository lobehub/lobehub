const content = `# lh provider - AI Provider Management

Manage AI providers and their configurations.

## Subcommands

- \`lh provider list\` - List all providers
- \`lh provider view <id>\` - View provider details
- \`lh provider create --id <id> -n <name> [-s <source>] [--sdk-type <type>]\` - Create provider
- \`lh provider edit <id> [-n <name>] [-d <description>]\` - Update provider
- \`lh provider config <id> [--api-key <key>] [--base-url <url>] [--show]\` - Configure settings
- \`lh provider test <id> [-m <model>]\` - Test provider connectivity
- \`lh provider toggle <id> [--enable|--disable]\` - Enable/disable provider
- \`lh provider delete <id> [--yes]\` - Delete provider

## Tips

- Use \`lh provider config <id> --show\` to view current configuration
- \`lh provider test\` verifies API key and connectivity
`;

export default content;
