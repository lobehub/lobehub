const content = `# Bot Platform Setup Guide

Step-by-step guides for connecting agents to messaging platforms.
When a user asks to connect a platform (e.g. "帮我链接 Discord"), follow the guide for that platform below.

## General Workflow

1. Guide the user to obtain credentials from the platform's developer portal
2. Run \`lh bot add\` with the collected credentials
3. Run \`lh bot test <botId>\` to validate credentials
4. Run \`lh bot connect <botId>\` to start the bot
5. Confirm the bot is online with \`lh bot list -a <agentId>\`

---

## Discord

**Portal:** https://discord.com/developers/applications

### Step 1: Create a Discord Application

1. Go to the Discord Developer Portal
2. Click **"New Application"** → enter a name → click **"Create"**
3. On the **General Information** page, copy the **Application ID** and the **Public Key**

### Step 2: Create a Bot and Get Token

1. In the left sidebar, click **"Bot"**
2. Click **"Reset Token"** → confirm → copy the **Bot Token** (save it — you can only see it once)
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**

### Step 3: Invite the Bot to Your Server

1. In the left sidebar, click **"OAuth2"**
2. Under **OAuth2 URL Generator**, select scope: **bot**
3. Under Bot Permissions, select: **Send Messages**, **Read Message History**, **Add Reactions**, **Manage Messages** (optional), **Create Public Threads** (optional)
4. Copy the generated URL, open it in browser, and select the server to add the bot

### Step 4: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform discord --app-id <applicationId> --bot-token <botToken> --public-key <publicKey>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

### Credentials Summary

| Field | Required | Where to Find |
|-------|----------|---------------|
| Application ID | Yes | General Information → Application ID |
| Bot Token | Yes | Bot → Reset Token |
| Public Key | Yes | General Information → Public Key |

---

## Slack

**Portal:** https://api.slack.com/apps

### Step 1: Create a Slack App

1. Go to the Slack API portal and click **"Create New App"**
2. Choose **"From scratch"** → enter a name → select workspace → **"Create App"**
3. On the **Basic Information** page, note the **App ID** and copy the **Signing Secret**

### Step 2: Configure Bot Token

1. In the left sidebar, go to **"OAuth & Permissions"**
2. Under **Bot Token Scopes**, add: \`chat:write\`, \`channels:read\`, \`channels:history\`, \`reactions:read\`, \`reactions:write\`, \`users:read\`, \`pins:read\`, \`pins:write\`
3. Click **"Install to Workspace"** → authorize
4. Copy the **Bot User OAuth Token** (starts with \`xoxb-\`)

### Step 3: (Optional) Enable Socket Mode for WebSocket

1. In the left sidebar, go to **"Socket Mode"** → enable it
2. Generate an **App-Level Token** with \`connections:write\` scope (starts with \`xapp-\`)
3. This enables WebSocket mode instead of webhook

### Step 4: Configure Event Subscriptions

1. Go to **"Event Subscriptions"** → enable events
2. Subscribe to bot events: \`message.channels\`, \`message.groups\`, \`message.im\`, \`app_mention\`

### Step 5: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform slack --app-id <appId> --bot-token <xoxbToken> --signing-secret <signingSecret>
# If using Socket Mode, also pass: --app-token <xappToken>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

### Credentials Summary

| Field | Required | Where to Find |
|-------|----------|---------------|
| App ID | Yes | Basic Information → App ID |
| Bot Token | Yes | OAuth & Permissions → Bot User OAuth Token |
| Signing Secret | Yes | Basic Information → Signing Secret |
| App Token | No (WebSocket mode) | Basic Information → App-Level Tokens |

---

## Telegram

**Portal:** https://t.me/BotFather

### Step 1: Create a Bot via BotFather

1. Open Telegram and search for **@BotFather**
2. Send \`/newbot\` → follow the prompts to set a name and username
3. BotFather will reply with the **Bot Token** — copy it

### Step 2: (Optional) Set Bot Privacy

- Send \`/setprivacy\` to BotFather → select your bot → choose **Disable** to allow the bot to see all group messages
- Send \`/setjoingroups\` → **Enable** if you want the bot to be addable to groups

### Step 3: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform telegram --bot-token <botToken>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

### Credentials Summary

| Field | Required | Where to Find |
|-------|----------|---------------|
| Bot Token | Yes | BotFather → /newbot response |
| Secret Token | No | Self-defined (for webhook verification) |

---

## Feishu (飞书)

**Portal:** https://open.feishu.cn/app

### Step 1: Create a Feishu App

1. Go to the Feishu Open Platform and click **"Create Custom App"**
2. Enter app name and description → **"Create"**
3. Copy the **App ID** and **App Secret** from the **Credentials & Basic Info** page

### Step 2: Configure Bot Capability

1. Go to **"Add Capability"** → enable **"Bot"**
2. Under **Event Subscriptions**, subscribe to: \`im.message.receive_v1\`
3. (If using webhook) Set the **Request URL** to the webhook endpoint

### Step 3: (Optional) Configure Encrypt Key and Verification Token

1. In **Event Subscriptions** settings, you can find the **Encrypt Key** and **Verification Token**
2. These are optional but recommended for security

### Step 4: Publish the App

1. Go to **"Version Management"** → create a version → submit for review
2. If using within your own organization, approve it in the admin console

### Step 5: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform feishu --app-id <appId> --app-secret <appSecret>
# Optional: --verification-token <token> --encrypt-key <key>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

### Credentials Summary

| Field | Required | Where to Find |
|-------|----------|---------------|
| App ID | Yes | Credentials & Basic Info → App ID |
| App Secret | Yes | Credentials & Basic Info → App Secret |
| Verification Token | No | Event Subscriptions → Verification Token |
| Encrypt Key | No | Event Subscriptions → Encrypt Key |

---

## Lark

**Portal:** https://open.larksuite.com/app

Lark is the international version of Feishu. The setup process is identical — follow the Feishu guide above, using the Lark Open Platform portal instead.

### Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform lark --app-id <appId> --app-secret <appSecret>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

---

## QQ

**Portal:** https://q.qq.com/

### Step 1: Create a QQ Bot

1. Go to the QQ Open Platform and register as a developer
2. Create a new bot application
3. Copy the **App ID** and **App Secret**

### Step 2: Configure Permissions

1. In the bot management console, configure message-related permissions
2. Enable the bot for the target QQ groups or guilds

### Step 3: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform qq --app-id <appId> --app-secret <appSecret>
lh bot test <botId>
lh bot connect <botId>
\`\`\`

### Credentials Summary

| Field | Required | Where to Find |
|-------|----------|---------------|
| App ID | Yes | Bot management → App ID |
| App Secret | Yes | Bot management → App Secret |

---

## WeChat (微信)

**Setup Guide:** https://lobehub.com/docs/usage/channels/wechat

WeChat integration uses iLink Bot and works differently from other platforms — no manual credential input is needed.

### Step 1: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> --platform wechat
lh bot connect <botId>
\`\`\`

### Step 2: Scan QR Code

After running \`lh bot connect\`, a QR code will be displayed. Scan it with WeChat to link your account.

### Notes

- WeChat uses polling mode (long-polling)
- Credentials are populated automatically after QR scan
- No developer portal setup required

---

## Troubleshooting

- **\`lh bot test\` fails:** Double-check credentials — tokens may have been regenerated or expired
- **Bot connects but doesn't respond:** Check that the bot has been invited to the channel/server and has proper permissions
- **Webhook issues:** Ensure the webhook URL is accessible from the platform's servers
- **Connection drops:** Use \`lh bot connect <botId>\` to reconnect; check \`lh bot list\` for status
`;

export default content;
