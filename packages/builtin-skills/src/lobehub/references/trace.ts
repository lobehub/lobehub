const content = `# lh trace - Agent Execution Traces

Inspect what an agent run actually did: each step, the LLM payload, the tool calls,
and the context it ran with. Use it to explain a past run instead of guessing.

## Operations (\`lh trace op\`)

- \`lh trace op list [--topic <topicId>] [-l <n>] [-j]\` - List recorded operations (\`--topic\` reads them from the server)
- \`lh trace op inspect [target] [-j]\` - Overview of one operation (\`target\`: operation id, trace id, snapshot path, URL or \`latest\`)
  - \`-s <n>\` one step · \`-m\` messages · \`-t\` tool calls · \`-e\` raw events · \`-c\` runtime context
  - \`-r\` full system role · \`--env\` environment context · \`-d <n>\` diff against step N (with \`-r\` / \`--env\`)
  - \`-T\` tools registered in the LLM payload · \`-M\` user memory · \`-p\` context engine input
  - \`--msg <n>\` / \`--msg-input <n>\` full content of message N in the final payload / engine input
- \`lh trace op replay [target] [-s <n>] [-m <provider/model,...>] [--all-steps] [--json]\` - Re-issue a recorded LLM call, optionally against other models (this spends tokens)

## Goals (\`lh trace goal\`)

- \`lh trace goal list [--server] [-l <n>] [-j]\` - List recorded goal trajectories
- \`lh trace goal inspect <target> [-a <n>] [-j]\` - Show a goal's advances and the decision behind each tick

## Tips

- Without \`--topic\` / \`--server\`, \`list\` only shows snapshots saved on this machine. To find the runs of a conversation, use \`lh trace op list --topic <topicId>\`
- Start with the overview, then drill into the step that went wrong with \`-s <n> -t\`
`;

export default content;
