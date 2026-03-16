const content = `# lh bot - Bot Integration Management

Manage bot integrations that connect agents to messaging platforms.

## Supported Platforms

Discord, Slack, Telegram, Lark, Feishu

## Subcommands

- \`lh bot list [-a <agentId>] [--platform <p>]\` - List bot integrations
- \`lh bot view <botId> [-a <agentId>]\` - View bot details
- \`lh bot add -a <agentId> --platform <p> [--bot-token <t>] [--app-id <id>]\` - Add bot to agent
- \`lh bot update <botId> [--bot-token <t>] [--platform <p>]\` - Update bot credentials
- \`lh bot remove <botId> [--yes]\` - Remove bot integration
- \`lh bot enable <botId>\` - Enable bot
- \`lh bot disable <botId>\` - Disable bot
- \`lh bot connect <botId> [-a <agentId>]\` - Connect and start bot

## Tips

- Each platform requires specific credentials (token, app ID, secrets)
- Use \`lh bot connect\` to start a long-running bot connection
`;

export default content;
