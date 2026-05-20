const content = `# Discord Bot Setup Guide

Connect a Discord bot to your agent.

**Developer Portal:** https://discord.com/developers/applications

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Application ID | Yes | Your app's unique ID |
| Public Key | Yes | Used to verify requests from Discord |
| Bot Token | Yes | Bot's authentication token |

## Step-by-Step Setup

### Step 1: Create a Discord Application

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** (top right)
3. Enter an app name → click **"Create"**
4. On the **General Information** page that opens, copy:
   - **Application ID** (shown as "APPLICATION ID")
   - **Public Key** (shown as "PUBLIC KEY")

### Step 2: Create the Bot and Get Token

1. In the left sidebar, click **"Bot"**
2. Click **"Add Bot"** → confirm
3. Under the bot's username, click **"Reset Token"** → confirm → copy the **Bot Token**
   > Save the token immediately — it is only shown once
4. Scroll down to **Privileged Gateway Intents** and enable:
   - **MESSAGE CONTENT INTENT** — required to read message text
   - **SERVER MEMBERS INTENT** — recommended for member lookup

### Step 3: Set Bot Permissions and Invite to Server

1. In the left sidebar, click **"OAuth2"** → **"URL Generator"**
2. Under **Scopes**, check:
   - \`bot\`
   - \`applications.commands\` (for slash command support)
3. Under **Bot Permissions**, check:
   - Send Messages
   - Read Message History
   - Add Reactions
   - Manage Messages (optional, for message deletion)
   - Create Public Threads (optional)
4. Copy the generated URL at the bottom, open it in a browser, and select the server to add the bot

### Step 4: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> \\
  --platform discord \\
  --app-id <applicationId> \\
  --public-key <publicKey> \\
  --bot-token <botToken>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Notes

- **Message Content Intent** is critical — without it, the bot receives empty message content
- Apps with 100+ servers must apply for Discord verification to use privileged intents
- If you regenerate the bot token, the old one immediately stops working — update the bot config with \`lh bot update\`
- Discord uses a WebSocket gateway (not webhooks) — \`lh bot connect\` keeps the connection alive
`;

export default content;
