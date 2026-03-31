const content = `# lh topic - Conversation Topic Management

Manage conversation topics (chat sessions).

## Subcommands

- \`lh topic list [--agent-id <id>] [-L <limit>] [--page <n>]\` - List topics with pagination
- \`lh topic search <keywords> [--agent-id <id>]\` - Search topics by keywords
- \`lh topic create -t <title> [--agent-id <id>] [--favorite]\` - Create a topic
- \`lh topic edit <id> [-t <title>] [--favorite] [--no-favorite]\` - Update topic
- \`lh topic delete <ids...> [--yes]\` - Delete one or more topics
- \`lh topic recent [-L <limit>]\` - List recently accessed topics

## Tips

- Topics are associated with agents; use \`--agent-id\` to filter
- Use \`--json\` for structured output suitable for piping
`;

export default content;
