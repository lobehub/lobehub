const content = `# QQ Bot Setup Guide

Connect a QQ Official Bot to your agent.

**Developer Portal:** https://q.qq.com/

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Application ID (App ID) | Yes | Your bot's numeric App ID |
| App Secret | Yes | Bot authentication secret |

## Connection Modes

- **WebSocket** — bot maintains persistent gateway connection
- **Webhook** — QQ POSTs events to your public HTTPS URL (ports 80, 443, 8080, 8443 only)

## Prerequisites

- QQ account with **real-name verification** completed (required before creating any bot)
- Developer account registration on the QQ Open Platform (enterprise or individual)

## Step-by-Step Setup

### Step 1: Register as a Developer

1. Go to https://q.qq.com/ and log in with QQ
2. Scan the QR code with your phone QQ to authenticate
3. Complete developer registration:
   - **Enterprise**: provide business license and bank verification
   - **Individual**: complete identity verification via manager binding
4. Real-name verification must be done in QQ client settings first if not already done

### Step 2: Create a Bot Application

1. In the QQ Open Platform dashboard, click **"创建机器人"** (Create Bot)
2. Fill in:
   - Bot name
   - Bot avatar/icon
   - Scenario type (single chat, group chat, or guild/channel)
3. Submit — the platform immediately creates a new bot account
   > Note: maximum 5 bots per QQ account

### Step 3: Get App ID and App Secret

1. In the bot management page, go to **"开发"** (Development) → **"开发设置"** (Development Settings)
2. Copy:
   - **AppID** — your bot's numeric identifier
   - **AppSecret** — click to reveal
   > **Critical**: Save AppSecret immediately — if you navigate away, you must regenerate it (no recovery)

### Step 4: Configure Permissions (Intents)

QQ bots use intent flags to subscribe to event types:

| Intent | Bit | Description |
|--------|-----|-------------|
| GUILD_MESSAGES | 1 << 9 | All messages in guild channels (private bots only) |
| PUBLIC_GUILD_MESSAGES | 1 << 30 | @bot mentions in guilds (public bots) |
| DIRECT_MESSAGE | 1 << 12 | Private/direct messages |
| GROUP_AND_C2C_EVENT | 1 << 25 | Group chat and 1-on-1 messages |

Base intents (GUILDS, GUILD_MEMBERS) are enabled by default and need no approval.
Some specialized events require explicit approval from Tencent.

### Step 5: Configure Webhook or WebSocket

#### Webhook Mode

1. In the bot settings, set **Callback URL** (must be HTTPS, ports: 80/443/8080/8443)
2. Enable the event types you want to subscribe to
3. QQ validates the endpoint by sending a challenge request

#### WebSocket Mode

- LobeHub's \`lh bot connect\` handles the WebSocket gateway automatically
- No URL configuration needed — just provide AppID and AppSecret

### Step 6: Configure IP Whitelist

1. In development settings, add your server's IP address to the **IP whitelist**
2. IP whitelist is required — without it, API calls and bot launch are blocked
3. For LobeHub-hosted bots, contact support for the outbound IP range to whitelist

### Step 7: Test in Sandbox, Then Submit for Review

1. Configure sandbox environment for testing at: https://sandbox.api.sgroup.qq.com
2. Add sandbox-specific QQ groups, channels, or users for testing
3. Complete all self-testing
4. Submit the bot for Tencent review in the portal
5. After manual approval, the bot can be activated and added in QQ client

### Step 8: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> \\
  --platform qq \\
  --app-id <appId> \\
  --app-secret <appSecret>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Notes

- **Real-name verification is mandatory** — cannot create a bot without it
- **AppSecret is not recoverable** — save it when first generated, or regenerate if lost
- **All bots require Tencent manual review** before going live — allow several business days
- **IP whitelist is required** for production — configure before deployment
- QQ bots do not support Markdown or message editing
- Each bot has an isolated OpenID namespace — you cannot use one bot's user OpenIDs with another bot's API
`;

export default content;
