const content = `# WeChat Bot Setup Guide

Connect a WeChat bot to your agent via iLink API.

**Setup Guide:** https://lobehub.com/docs/usage/channels/wechat

## Credentials

WeChat credentials (bot token) are populated by the **Web UI QR scan flow** — they cannot be set up via CLI alone.

## Connection Mode

WeChat uses **polling** mode (long-polling) — no webhook URL or WebSocket setup needed.

## Setup: Use the Web UI

WeChat requires a QR code scan to link your account, which is only supported through the LobeHub Web UI:

1. Open your agent in LobeHub
2. In the left sidebar, click **消息频道** (Message Channel)
3. Select **WeChat** from the platform list on the right
4. A QR code is displayed — scan it with WeChat to authenticate
5. Once scanned, credentials are saved automatically and the bot connects

> WeChat cannot be set up via CLI. The \`lh bot connect\` command only starts an already-configured provider and does not perform the QR authentication flow.

## After Web UI Setup: CLI Operations

Once the bot is configured via Web UI, you can use CLI to manage and monitor it:

\`\`\`bash
# Check bot status
lh bot list -a <agentId>

# Reconnect if disconnected
lh bot connect <botId>

# Send a message
lh bot message send <botId> --target <conversationId> --message "Hello"
\`\`\`

## Limitations

- No message editing support (WeChat API restriction)
- Character limit: 2048 characters per message
- No native Markdown rendering — WeChat displays plain text

## Notes

- WeChat uses iLink Bot API — no developer portal setup is needed
- The QR code session expires periodically; reconnect via Web UI when it does
- Default debounce is 5 seconds (higher than other platforms) due to WeChat's polling architecture
`;

export default content;
