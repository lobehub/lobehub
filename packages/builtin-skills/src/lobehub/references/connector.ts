const content = `# lh connector (alias: lh mcp) - MCP Connector Management

Add and manage MCP servers as connectors. Each connector stores its server endpoint and credentials, and its tool list is synced so agents can call those tools. \`lh mcp\` is an alias: \`lh mcp list\` and \`lh connector list\` run the same command.

## Subcommands

- \`lh connector list [--json [fields]]\` - List connectors with id, identifier, source, status and tool count
- \`lh connector add --url <url> [options]\` - Add a remote (streamable HTTP / SSE) MCP server and sync its tools
- \`lh connector add --stdio-cmd <command> [--stdio-arg <arg>]...\` - Add a stdio MCP server launched on this machine
- \`lh connector refresh <idOrIdentifier>\` (alias \`sync\`) - Refresh OAuth tokens and re-fetch the tool list
- \`lh connector remove <idOrIdentifier> [--yes]\` - Remove a connector
- \`lh connector request <identifier> [options]\` - Inside a Channel run: post a card the person connects with one click

\`<idOrIdentifier>\` accepts the connector uuid or its identifier; when several connectors share an identifier, pass the uuid.

## add options

- \`--url <url>\` or \`--stdio-cmd <command>\` - Transport; pass exactly one
- \`--stdio-arg <arg>\` - stdio argument, repeatable and kept in order; write an argument that starts with \`-\` as \`--stdio-arg=-y\`
- \`--name <name>\` - Display name (defaults to the identifier)
- \`--identifier <id>\` - Letters, digits, \`_\` and \`-\`; derived from \`--name\`, then the URL host (minus \`www.\` / \`mcp.\`), then the command name
- \`--auth <none|bearer|oauth2>\` - Auth type; defaults to \`bearer\` when \`--token\` is given, otherwise \`none\`
- \`--token <token>\` - Bearer token, only with \`--auth bearer\`
- \`--header <key:value>\` - Custom request header for HTTP connectors, repeatable. Header values are stored as connector metadata and returned by \`list\`, so put a secret in \`--token\`, not in a header
- \`--force\` - Overwrite an existing connector with the same identifier (otherwise \`add\` refuses the duplicate)
- \`--json [fields]\` - Machine-readable result

stdio connectors accept no \`--auth\` or \`--header\`. Their command and arguments are stored in plain text, returned by \`list\` to anyone who can see the connector, and visible in the local process list, so never put a token or key in \`--stdio-cmd\` or \`--stdio-arg\`. A stdio server that needs a secret cannot currently be configured securely with this command; prefer the server's HTTP endpoint with \`--token\` (bearer tokens are stored as credentials and never returned by \`list\`).

## Tool sync after add

- \`none\` / \`bearer\`: \`add\` creates the connector, then syncs its tools immediately and prints the tool count. If the sync fails, a newly created connector is rolled back, so fix the URL or credentials and run \`add\` again. A connector overwritten with \`--force\` is kept with the new settings, not restored; fix it and rerun \`add\` with \`--force\`.
- \`oauth2\`: \`add\` creates the connector and prints an authorization URL (\`status: pending_oauth\` in \`--json\`). The user opens it in a browser; on success the authorization callback syncs the tools itself. The page says \`Authorization complete\` even when that sync fails, so after the user authorizes, check \`lh connector list\`: \`connected\` with a non-zero tool count means the connector is ready; \`error\` or 0 tools means the sync failed, so run \`lh connector refresh <identifier>\`.
- Remote URLs reachable from the server are synced by the server. stdio commands and local URLs are listed from this machine and the result is uploaded; the output marks this as \`synced from this machine\` (\`local: true\` in \`--json\`). Local means \`localhost\`, loopback, \`0.0.0.0\` and private IPv4 addresses (10.x, 172.16-31.x, 192.168.x). LAN hostnames such as \`*.local\` are synced by the server, so use the IP address instead.
- Run \`refresh\` when the MCP server's tools change. It is a maintenance operation: in a workspace it may require permission to manage that connector. Refreshing a stdio connector runs its stored command locally; a command not yet approved on this machine requires an interactive confirmation, so \`refresh\` fails in a non-interactive shell until a person approves it.

## Asking the person to connect (Channel runs)

When the person asks you to connect an app or MCP server, or a task needs one that is not connected, prefer \`lh connector request\` over \`add\`: it posts a card in the current Channel conversation, and the person connects with one click (OAuth runs in their app, no URL or key passes through chat). It only works inside a Channel run.

- \`<identifier>\` - A catalog identifier (LobeHub, Composio or official MCP, e.g. \`github\`, \`notion\`, \`sentry\`)
- \`--url <url>\` - The https MCP endpoint of a server outside the catalog; then also \`--name <name>\` and \`--auth <none|oauth>\` (default \`oauth\`)
- \`--reason <text>\` - One short sentence on what you will do with it, shown on the card
- \`--request-key <key>\` - Reuse to retry without posting twice

The connector is usable from your next turn once connected. A server that needs a bearer token still goes through \`add --token\`.

## Examples

\`\`\`bash
lh mcp add --url https://mcp.example.com/mcp --name Example --token "$EXAMPLE_TOKEN"
lh mcp add --url https://mcp.example.com/oauth/mcp --identifier example-oauth --auth oauth2
lh mcp add --stdio-cmd uvx --stdio-arg mcp-server-fetch --name Fetch
lh mcp list --json id,identifier,status,toolCount
lh mcp refresh example
lh mcp remove example --yes
lh connector request notion --reason "to read the spec pages"
lh connector request context7 --url https://mcp.context7.com/mcp --name Context7 --auth none
\`\`\`
`;

export default content;
