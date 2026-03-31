const content = `# lh message - Message Management

Manage chat messages.

## Subcommands

- \`lh message list [--topic-id <id>] [--agent-id <id>] [-L <limit>] [--page <n>]\` - List messages
- \`lh message search <keywords>\` - Search messages by keywords
- \`lh message delete <ids...> [--yes]\` - Delete messages
- \`lh message count [--start <date>] [--end <date>]\` - Count messages
- \`lh message heatmap\` - Get message activity heatmap

## Tips

- Filter by \`--topic-id\` to get messages from a specific conversation
- Use \`--user\` flag to filter by message role (user/assistant)
`;

export default content;
