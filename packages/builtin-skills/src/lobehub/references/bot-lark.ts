const content = `# Lark Bot Setup Guide

Connect a Lark custom app bot to your agent. Lark is the international version of Feishu — setup is nearly identical.

**Developer Console:** https://open.larksuite.com/app

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Application ID (App ID) | Yes | Your app's unique identifier |
| App Secret | Yes | App authentication secret |
| Verification Token | No | Validates webhook requests come from Lark |
| Encrypt Key | No | AES key for encrypting webhook payloads |

## Connection Modes

- **WebSocket** (recommended) — SDK maintains persistent connection; no public URL needed
- **Webhook** — Lark POSTs events to your public HTTPS URL

## Step-by-Step Setup

### Step 1: Create a Custom App

1. Go to https://open.larksuite.com/app and sign in with your Lark account
2. Click **"Create Custom App"**
3. Enter app name, description, and upload an icon
4. Click **"Create"**

### Step 2: Get App ID and App Secret

1. In the left sidebar, click **"Credentials"** (or **"Credentials & Basic Info"**)
2. Copy:
   - **App ID**
   - **App Secret** — click "Show" or "Copy" to reveal

### Step 3: Enable Bot Capability

1. In the left sidebar, go to **"Features"** → **"Bot"**
2. Enable the Bot feature
3. (Optional) Set a custom bot name

### Step 4: Configure Event Subscriptions

#### Option A: WebSocket (Recommended)

1. In the left sidebar, click **"Events & Callbacks"** → **"Event Configuration"**
2. Select **"Use long connection to receive events"** (WebSocket mode)
3. Under **"Add Events"**, add:
   - **im.message.receive_v1** — receive messages sent to the bot
4. Grant the required permission \`im:message\` when prompted
5. Click **"Save"**

#### Option B: Webhook Mode

1. Select **"Send callbacks to developer server"**
2. Enter your public HTTPS **Request URL**
3. Lark sends a \`challenge\` parameter for URL verification — your server must return it
4. Add the same events as above

### Step 5: Get Verification Token and Encrypt Key (Webhook Only)

1. In **"Events & Callbacks"** → **"Encryption Strategy"**
2. Copy:
   - **Verification Token**
   - **Encrypt Key** — generate one if not yet created

### Step 6: Add Required Permissions

1. In the left sidebar, click **"Permissions & Scopes"**
2. Add:
   - \`im:message\` — send and receive messages
   - \`im:message.group_at_msg:readonly\` — receive @bot mentions in groups (if needed)

### Step 7: Publish the App

1. In the left sidebar, click **"App Release"** or **"Version Management"**
2. Create a new version with release notes
3. Submit for review — workspace admin approves in **Admin → Workplace → App Review**
4. Once approved, admin sets the availability range (all users or specific teams)
5. The bot becomes available to users in the workspace

### Step 8: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> \\
  --platform lark \\
  --app-id <appId> \\
  --app-secret <appSecret>

# Optional: with webhook verification
lh bot add -a <agentId> \\
  --platform lark \\
  --app-id <appId> \\
  --app-secret <appSecret> \\
  --verification-token <token> \\
  --encrypt-key <key>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Differences from Feishu

| Aspect | Feishu (Chinese) | Lark (International) |
|--------|-----------------|----------------------|
| Console URL | open.feishu.cn | open.larksuite.com |
| Data center | China (Beijing) | International (Singapore) |
| Language | Chinese UI | English UI |
| API compatibility | Same spec | Same spec |
| Publishing | Admin Console review | Admin → Workplace → App Review |

## Notes

- Lark and Feishu share the same API spec — the same event types, permission names, and bot capabilities apply
- \`im.message.receive_v1\` is the critical event for receiving messages
- Lark may send duplicate events — use \`message_id\` for deduplication, not \`event_id\`
- Lark does not render Markdown natively — use plain text or Lark's card message format
- Message deduplication: rate limit is 100 requests/minute per bot, 5 requests/second
`;

export default content;
