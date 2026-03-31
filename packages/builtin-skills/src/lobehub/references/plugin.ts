const content = `# lh plugin - Plugin Management

Manage installed plugins (external tool integrations).

## Subcommands

- \`lh plugin list\` - List installed plugins
- \`lh plugin install -i <identifier> [--manifest <url>] [--type <type>] [--settings <json>]\` - Install plugin
- \`lh plugin uninstall <id> [--yes]\` - Uninstall plugin
- \`lh plugin update <id> [--manifest <url>] [--settings <json>]\` - Update plugin

## Tips

- Plugins extend agent capabilities with external tools
- Use \`--settings\` to pass JSON configuration during install/update
`;

export default content;
