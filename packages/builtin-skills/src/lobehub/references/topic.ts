const content = `# lh topic - Conversation Topic Management

Manage conversation topics (chat sessions).

## Subcommands

- \`lh topic list [--agent-id <id>] [-L <limit>] [--page <n>]\` - List topics with pagination
- \`lh topic view <id> [-L <limit>] [--from <n>] [--to <n>] [--no-messages]\` - View topic details and its messages
- \`lh topic search <keywords> [--agent-id <id>]\` - Search topics by keywords
- \`lh topic create -t <title> [--agent-id <id>] [--favorite]\` - Create a topic
- \`lh topic edit <id> [-t <title>] [--favorite] [--no-favorite]\` - Update topic
- \`lh topic delete <ids...> [--yes]\` - Delete one or more topics
- \`lh topic recent [-L <limit>]\` - List recently accessed topics
- \`lh topic send <id> -c <message>\` - Send a message to a topic and have its agent act on it (queued behind a running turn)
- \`lh topic send --new -c <message> [--agent-id <id>] [--where inherit|new-worktree|none] [--base-branch <branch>]\` - Open a new topic; run from inside a conversation it is a sub-topic of it
- \`lh topic list --opened-by-me [--parent-topic-id <id>]\` - List the sub-topics this conversation opened, with their state
- \`lh topic stop <id>\` - Stop a topic's current turn
- \`lh topic archive <id> [--all]\` - Archive a topic; \`--all\` also stops and archives its sub-topics

## Sub-topics and other ways to hand work off

Pick by what you need back:

- The result inside this turn → do it yourself, or with your own sub-agents.
- An independent conversation running in parallel that you and the user can follow up on → a sub-topic (\`lh topic send --new -c <message>\` from inside a conversation; Labs → Better Coding Experience). It stays on this device; \`--where\` picks the directory: \`inherit\` (default, shares uncommitted files), \`new-worktree\` (a fresh branch and worktree), \`none\`. Each finished turn reports back as a \`<sub_topic_result>\` message and wakes the parent — do not poll; continue it with \`lh topic send <id> -c <message>\`.
- Work tracked on the task board, on a schedule or with verification → \`lh task\` (each run gets its own topic, on the device and directory configured on the task).
- Group conversations and Channels keep their own collaboration.

## Threads

A thread is a side conversation branched off a message inside a topic.

- \`lh thread list --topic-id <id> [--json]\` - List threads in a topic
- \`lh thread list-all [--json]\` - List all your threads
- \`lh thread delete <id> [--remove-children] [--yes]\` - Delete a thread

## Tips

- Topics are associated with agents; use \`--agent-id\` to filter
- Use \`--json\` for structured output suitable for piping
- \`lh topic view\` shows 50 messages per page by default; page with \`--from\` / \`--to\`, or \`--no-messages\` for metadata only
- Topic ids start with \`tpc_\`. When the user pastes one, or a \`<refer_topic>\` tag carries one in its \`id\` attribute, read that conversation with \`lh topic view <id>\` (page long topics with \`--from\` / \`--to\`)
- When the prompt injects a \`<recent_topics>\` block (IM channels without a history-read API), use the \`id\` attribute with \`lh topic view <id>\` to read that session's full conversation
`;

export default content;
