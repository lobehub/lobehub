const content = `# lh connector (alias: lh mcp) - MCP Connector Management

Add and manage MCP servers as connectors. Each connector stores its server endpoint and credentials, and its tool list is synced so agents can call those tools. \`lh mcp\` is an alias: \`lh mcp list\` and \`lh connector list\` run the same command.

## Subcommands

- \`lh connector list [--json [fields]]\` - List connectors with id, identifier, source, status and tool count
- \`lh connector add --url <url> [options]\` - Add a remote (streamable HTTP / SSE) MCP server and sync its tools
- \`lh connector add --stdio-cmd <command> [--stdio-arg <arg>]...\` - Add a stdio MCP server launched on this machine
- \`lh connector refresh <idOrIdentifier>\` (alias \`sync\`) - Refresh OAuth tokens and re-fetch the tool list
- \`lh connector remove <idOrIdentifier> [--yes]\` - Remove a connector

\`<idOrIdentifier>\` accepts the connector uuid or its identifier; when several connectors share an identifier, pass the uuid.

## add options

- \`--url <url>\` or \`--stdio-cmd <command>\` - Transport; pass exactly one
- \`--stdio-arg <arg>\` - stdio argument, repeatable and kept in order; write an argument that starts with \`-\` as \`--stdio-arg=-y\`
- \`--name <name>\` - Display name (defaults to the identifier)
- \`--identifier <id>\` - Letters, digits, \`_\` and \`-\`; derived from \`--name\`, then the URL host (minus \`www.\` / \`mcp.\`), then the command name
- \`--auth <none|bearer|oauth2>\` - Auth type; defaults to \`bearer\` when \`--token\` is given, otherwise \`none\`
- \`--token <token>\` - Bearer token, only with \`--auth bearer\`
- \`--header <key:value>\` - Custom request header for HTTP connectors, repeatable
- \`--force\` - Overwrite an existing connector with the same identifier (otherwise \`add\` refuses the duplicate)
- \`--json [fields]\` - Machine-readable result

stdio connectors accept no \`--auth\` or \`--header\`; pass secrets through the command itself.

## Tool sync after add

- \`none\` / \`bearer\`: \`add\` creates the connector, then syncs its tools immediately and prints the tool count. If the sync fails, a newly created connector is rolled back, so fix the URL or credentials and run \`add\` again. A connector overwritten with \`--force\` is kept with the new settings, not restored; fix it and rerun \`add\` with \`--force\`.
- \`oauth2\`: \`add\` creates the connector and prints an authorization URL (\`status: pending_oauth\` in \`--json\`). No tools are synced yet: after the user authorizes in a browser, run \`lh connector refresh <identifier>\`.
- Remote URLs reachable from the server are synced by the server. stdio commands and local URLs are listed from this machine and the result is uploaded; the output marks this as \`synced from this machine\` (\`local: true\` in \`--json\`). Local means \`localhost\`, loopback, \`0.0.0.0\` and private IPv4 addresses (10.x, 172.16-31.x, 192.168.x). LAN hostnames such as \`*.local\` are synced by the server, so use the IP address instead.
- Run \`refresh\` whenever the MCP server's tools change. Refreshing a stdio connector runs its stored command locally; a command not yet approved on this machine requires an interactive confirmation, so \`refresh\` fails in a non-interactive shell until a person approves it.

## Examples

\`\`\`bash
lh mcp add --url https://mcp.example.com/mcp --name Example --token "$EXAMPLE_TOKEN"
lh mcp add --url https://mcp.example.com/oauth/mcp --identifier example-oauth --auth oauth2
lh mcp add --stdio-cmd uvx --stdio-arg mcp-server-fetch --name Fetch
lh mcp list --json id,identifier,status,toolCount
lh mcp refresh example
lh mcp remove example --yes
\`\`\`
`;

export default content;
