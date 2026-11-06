const content = `# lh legacy-plugin - Legacy Plugin Management

Manage legacy 1.0 plugins (stored in \`user_installed_plugins\`). New plugins cannot be created here: add an MCP server with \`lh connector add --url <url>\`, and re-sync an existing connection with \`lh connector refresh <idOrIdentifier>\`.

## Subcommands

- \`lh legacy-plugin list\` - List installed plugins
- \`lh legacy-plugin uninstall <id> [--yes]\` - Uninstall plugin
- \`lh legacy-plugin update <id> [--manifest <url>] [--settings <json>]\` - Update plugin

## Tips

- Plugins extend agent capabilities with external tools
- Use \`--settings\` to pass JSON configuration during update
`;

export default content;
