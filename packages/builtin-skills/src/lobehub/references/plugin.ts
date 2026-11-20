const content = `# lh legacy-plugin - Legacy Plugin Management

Manage legacy 1.0 plugins (stored in \`user_installed_plugins\`). New plugins cannot be installed or created here, and \`update\` only edits a plugin that is already installed. To install an MCP server or plugin, add it as a connector (see below).

## Subcommands

- \`lh legacy-plugin list\` - List installed plugins
- \`lh legacy-plugin uninstall <id> [--yes]\` - Uninstall plugin
- \`lh legacy-plugin update <id> [--manifest <url>] [--settings <json>]\` - Update an installed plugin

## Install an MCP server (connector)

- \`lh connector add --url <url> [--name <name>]\` - Add an HTTP / SSE MCP server and sync its tools
- \`lh connector add --url <url> --auth bearer --token <token>\` - Server that needs a bearer token
- \`lh connector add --url <url> --header <key:value>\` - Custom request header (repeatable)
- \`lh connector add --url <url> --auth oauth2\` - OAuth server; prints an authorization URL and syncs the tools once the user authorizes. If \`lh connector list\` then shows \`error\` or 0 tools, run \`lh connector refresh <identifier>\`
- \`lh connector add --stdio-cmd <command> [--stdio-arg <arg>]\` - Local stdio MCP server
- \`lh connector refresh <idOrIdentifier>\` - Re-sync the tool list of an existing connection
- \`lh connector list\` - List connectors

Full \`lh connector\` options and tool-sync behavior: \`references/connector\`.

## Tips

- A request to install a plugin from a manifest, with no MCP server URL or command, cannot be fulfilled: ask for the MCP server URL instead
- Use \`--settings\` to pass JSON configuration when updating an installed legacy plugin
`;

export default content;
