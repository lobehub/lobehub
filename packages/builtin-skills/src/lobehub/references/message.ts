const content = `# lh message - Message Management

Manage chat messages.

## Subcommands

- \`lh message list [--topic-id <id>] [--agent-id <id>] [-L <limit>] [--page <n>]\` - List messages
- \`lh message search <keywords> [--since <when>] [--until <when>] [--role <roles>] [--topic-id <id>] [--agent-id <id>] [--exact] [--include-system] [-L <n>] [-P <n>]\` - Search messages, newest first, with time, topic title and a match snippet
- \`lh message delete <ids...> [--yes]\` - Delete messages
- \`lh message count [--start <date>] [--end <date>]\` - Count messages
- \`lh message heatmap\` - Get message activity heatmap

## Notify a conversation

- \`lh notify --topic <topicId> -c <content> [--agent-id <id>] [--thread-id <id>] [--json]\` - Post a user message into a topic, which triggers the agent to reply
- \`lh notify --topic <topicId> -c <content> --role assistant [--message-id <id>] [--continue]\` - Write the message as the agent instead. \`--message-id\` updates that message in place, and \`--continue\` triggers a follow-up turn

Use it to report back to a conversation after background work finishes.

## Tips

- Filter by \`--topic-id\` to get messages from a specific conversation
- Use \`--user\` flag to filter by message role (user/assistant)
- \`message search\` hides system-written prompts of task, cron and eval runs; \`--include-system\` shows them
- For "what happened around X this week", prefer \`lh recall\` (see \`references/search\`): it also covers topics, goals and pages
`;

export default content;
