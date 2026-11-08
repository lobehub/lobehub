const content = `# lh legacy-plugin - Legacy Plugin Management

Manage legacy 1.0 plugins (stored in \`user_installed_plugins\`). For MCP connectors, use \`lh connector\` instead.

## Subcommands

- \`lh legacy-plugin list\` - List installed plugins
- \`lh legacy-plugin install -i <identifier> --manifest <json> [--type <type>] [--settings <json>]\` - Install plugin
- \`lh legacy-plugin uninstall <id> [--yes]\` - Uninstall plugin
- \`lh legacy-plugin update <id> [--manifest <url>] [--settings <json>]\` - Update plugin

## Tips

- Plugins extend agent capabilities with external tools
- Use \`--settings\` to pass JSON configuration during install/update
`;

export default content;
