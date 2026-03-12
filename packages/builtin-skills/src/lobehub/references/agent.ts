const content = `# lh agent - Agent Management

Manage agents (AI assistants with custom configurations).

## Subcommands

- \`lh agent list [-L <limit>] [-k <keyword>]\` - List agents
- \`lh agent view [agentId] [-s <slug>]\` - View agent configuration
- \`lh agent create -t <title> [-d <description>] [-m <model>] [-p <provider>] [-s <systemRole>]\` - Create agent
- \`lh agent edit [agentId] [-t <title>] [-d <description>] [-m <model>] [-s <systemRole>]\` - Update agent
- \`lh agent delete <agentId> [--yes]\` - Delete agent
- \`lh agent duplicate <agentId> [-t <title>]\` - Duplicate agent
- \`lh agent run -a <agentId> -p <prompt> [-t <topicId>] [--replay]\` - Run agent with a prompt
- \`lh agent status <operationId> [--history]\` - Check agent operation status

## Tips

- Use \`--slug\` to reference agents by slug instead of ID
- \`lh agent run --replay\` replays the full conversation output
- \`lh agent status --history\` shows operation execution history
`;

export default content;
