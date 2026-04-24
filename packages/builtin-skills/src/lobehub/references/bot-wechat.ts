const content = `# WeChat Bot Setup Guide

Connect a WeChat bot to your agent via iLink API.

**Setup Guide:** https://lobehub.com/docs/usage/channels/wechat

## Credentials

No manual credential input is required. Credentials are populated **automatically** after scanning a QR code with WeChat.

## Connection Mode

WeChat uses **polling** mode (long-polling) — no webhook URL or WebSocket setup needed.

## Step-by-Step Setup

### Step 1: Add the Bot in LobeHub

Run the CLI command to add the WeChat bot without any credentials:

\`\`\`bash
lh bot add -a <agentId> --platform wechat
\`\`\`

### Step 2: Connect and Scan QR Code

\`\`\`bash
lh bot connect <botId>
\`\`\`

After running \`connect\`, a **QR code** is displayed in the terminal. Scan it with your WeChat app to link your account.

### Step 3: Verify Connection

\`\`\`bash
lh bot list -a <agentId>
\`\`\`

The bot status should show as **connected**.

## Limitations

- No message editing support (WeChat API restriction)
- Character limit: 2048 characters per message
- No native Markdown rendering — WeChat displays plain text

## Notes

- WeChat uses iLink Bot API for the integration — no developer portal setup is needed on your side
- The QR code session expires; if the bot disconnects, re-run \`lh bot connect <botId>\` and scan again
- Default debounce is 5 seconds (higher than other platforms) due to WeChat's polling architecture
`;

export default content;
