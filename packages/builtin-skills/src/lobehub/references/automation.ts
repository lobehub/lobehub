const content = `# lh automation (alias: lh automations) - Automations (MCP Events subscriptions)

An automation runs an agent when a connector (MCP server) reports an event: an agent subscribed to that event in a conversation, and each event wakes it with what happened. Automations are not webhooks; custom webhook URLs are managed with \`lh webhook\` (see \`references/webhook\`). \`lh automation\` refuses a custom webhook's id and names the \`lh webhook\` command to use.

Creating an automation stays a conversation action: ask the agent to subscribe to the event. Changing what it follows (event, filter) means subscribing again and deleting the old one.

## Name and event

- **Name** - for people; \`rename\` sets it, \`rename --clear\` drops it so the event shows.
- **Event** - the connector event it follows (e.g. \`issue.opened\`); the agent knows the automation by it (\`<mcpEvent event=…>\` in the run). It is fixed for the automation's life and cannot be edited.

## Subcommands

- \`lh automation list [--agent <agentId>] [--json [fields]]\` - Automations you can see: id, name, connector, event, agent, status, where results go, last event
- \`lh automation view <id> [--json [fields]]\` - Name, event, connector, filter arguments, status and last error, where results go (a Topic, or a Channel / Thread), expiry, last event
- \`lh automation rename <id> <name>\` - Set the display name (at most 100 characters); the event stays
- \`lh automation rename <id> --clear\` - Drop the name; the automation shows its event
- \`lh automation check <id>\` - Check the subscription with its MCP server now: renews it, or recovers it after an error (once per 30 seconds)
- \`lh automation delete <id> [--yes]\` - Delete; this also ends the subscription on the MCP server, so the agent stops running on these events

\`<id>\` is the automation's uuid from \`lh automation list\`.

## Fixing a broken automation

\`view\` shows the last error with what to do. Common ones: the connector's authorization expired (reconnect the connector, then \`check\`), the connector no longer offers the event or access was revoked (delete it and ask the agent to subscribe again), results could not be posted to the Channel (the agent or its creator left it, or it was archived).

## Examples

\`\`\`bash
lh automation list --agent <agentId> --json id,name,identifier,status
lh automation view <id>
lh automation rename <id> "New GitHub issues"
lh automation rename <id> --clear
lh automation check <id>
lh automation delete <id> --yes
\`\`\`
`;

export default content;
