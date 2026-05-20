const content = `# Slack Bot Setup Guide

Connect a Slack bot to your agent.

**Developer Portal:** https://api.slack.com/apps

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Application ID | Yes | Your Slack App ID |
| Bot Token | Yes | Starts with \`xoxb-\` |
| Signing Secret | Yes | Verifies requests come from Slack |
| App Token | No | Starts with \`xapp-\`; required for Socket Mode (WebSocket) |

## Connection Modes

- **WebSocket (Socket Mode)** — bot maintains persistent connection; no public URL needed; requires App Token
- **Webhook** — Slack POSTs events to a public HTTPS URL you provide

## Step-by-Step Setup

### Step 1: Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → choose **"From scratch"**
3. Enter an app name and select your development workspace → **"Create App"**
4. You land on the **Basic Information** page. Copy:
   - **App ID** (under "App Credentials" section)
   - **Signing Secret** (click "Show" under "App Credentials" → copy)

### Step 2: Configure Bot Token Scopes

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll to **"Bot Token Scopes"** → click **"Add an OAuth Scope"**
3. Add these scopes:
   - \`chat:write\` — send messages
   - \`channels:read\` — list public channels
   - \`channels:history\` — read messages in public channels
   - \`groups:read\` / \`groups:history\` — private channels
   - \`im:read\` / \`im:history\` — direct messages
   - \`reactions:read\` / \`reactions:write\` — emoji reactions
   - \`pins:read\` / \`pins:write\` — pin messages
   - \`users:read\` — look up member info
4. Scroll up and click **"Install to Workspace"** → **"Allow"**
5. After installation, copy the **Bot User OAuth Token** (starts with \`xoxb-\`)

### Step 3A: Set Up Event Subscriptions (Webhook Mode)

1. In the left sidebar, click **"Event Subscriptions"**
2. Toggle **"Enable Events"** ON
3. Enter your public HTTPS webhook URL in **"Request URL"**
   - Slack sends a challenge to verify — your server must respond
4. Under **"Subscribe to bot events"**, add:
   - \`message.channels\` — messages in public channels
   - \`message.groups\` — messages in private channels
   - \`message.im\` — direct messages
   - \`app_mention\` — when bot is @mentioned
5. Click **"Save Changes"**

### Step 3B: Set Up Socket Mode (WebSocket — No Public URL Needed)

1. In the left sidebar, click **"Socket Mode"**
2. Toggle **"Enable Socket Mode"** ON
3. Go to **"Basic Information"** → scroll to **"App-Level Tokens"**
4. Click **"Generate Token and Scopes"**
5. Give the token a name, add scope: **\`connections:write\`**
6. Click **"Generate"** → copy the **App-Level Token** (starts with \`xapp-\`)
7. Go to **"Event Subscriptions"** and subscribe to the same bot events as Step 3A
   (No Request URL needed in Socket Mode)

### Step 4: Connect via CLI

\`\`\`bash
# Webhook mode
lh bot add -a <agentId> \\
  --platform slack \\
  --app-id <appId> \\
  --bot-token <xoxbToken> \\
  --signing-secret <signingSecret>

# Socket Mode (WebSocket) — also pass App Token
lh bot add -a <agentId> \\
  --platform slack \\
  --app-id <appId> \\
  --bot-token <xoxbToken> \\
  --signing-secret <signingSecret> \\
  --app-token <xappToken>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Notes

- **Bot Token vs User Token**: always use the \`xoxb-\` Bot Token — never use \`xoxp-\` User Tokens unless explicitly needed
- **Socket Mode** is recommended for development (no public URL needed) and is required if your server is behind a firewall
- Signing Secret validates that inbound webhook POST requests are genuinely from Slack
- If you add new scopes, reinstall the app to the workspace (a banner will appear at the top of the OAuth page)
`;

export default content;
