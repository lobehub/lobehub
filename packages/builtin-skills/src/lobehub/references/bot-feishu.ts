const content = `# Feishu (飞书) Bot Setup Guide

Connect a Feishu custom app bot to your agent.

**Developer Console:** https://open.feishu.cn/app

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Application ID (App ID) | Yes | Your app's unique identifier |
| App Secret | Yes | App authentication secret |
| Verification Token | No | Validates webhook requests come from Feishu |
| Encrypt Key | No | AES key for encrypting webhook payloads |

## Connection Modes

- **WebSocket** (recommended) — SDK maintains persistent connection; no public URL needed
- **Webhook** — Feishu POSTs events to your public HTTPS URL

## Step-by-Step Setup

### Step 1: Create a Custom App

1. Go to https://open.feishu.cn/app and sign in with your Feishu account
2. Click **"创建自建应用"** (Create Custom App)
3. Enter app name, description, and upload an icon
4. Click **"创建"** (Create)

### Step 2: Get App ID and App Secret

1. In the left sidebar, click **"凭证与基础信息"** (Credentials & Basic Info)
2. Copy:
   - **App ID** (应用ID)
   - **App Secret** (应用密钥) — click "查看" (View) to reveal

### Step 3: Enable Bot Capability

1. In the left sidebar, click **"应用能力"** (App Capabilities) → **"机器人"** (Bot)
2. Click **"开启机器人能力"** (Enable Bot)
3. (Optional) Set a custom bot name

### Step 4: Configure Event Subscriptions

#### Option A: WebSocket Long Connection (Recommended)

1. In the left sidebar, click **"事件与回调"** (Events & Callbacks) → **"事件配置"** (Event Configuration)
2. Select **"使用长连接接收事件"** (Use long connection to receive events)
3. Under **"添加事件"** (Add Events), add:
   - **im.message.receive_v1** — receive messages sent to the bot
4. Grant required permissions when prompted:
   - \`im:message\` — read and send messages
5. Click **"保存"** (Save)

#### Option B: Webhook Mode

1. Select **"使用 Webhook 接收事件"** (Use webhook to receive events)
2. Enter your public HTTPS **Request URL**
3. Feishu sends a \`url_verification\` challenge — your server must return the challenge value
4. Add the same events as above

### Step 5: Get Verification Token and Encrypt Key (Webhook Only)

1. In **"事件与回调"** → **"加密策略"** (Encryption Strategy)
2. Copy:
   - **Verification Token** (验证Token)
   - **Encrypt Key** (加密Key) — click to generate if not yet created

### Step 6: Add Required Permissions

1. In the left sidebar, click **"权限管理"** (Permission Management)
2. Search and add:
   - \`im:message\` — receive and send messages
   - \`im:message.group_at_msg\` — receive @bot messages in groups (if needed)
3. Publish the app (see Step 7) for permissions to take effect

### Step 7: Publish the App

1. In the left sidebar, click **"版本管理与发布"** (Version Management & Release)
2. Click **"创建版本"** (Create Version)
3. Fill in version notes → click **"保存"** (Save)
4. Click **"申请发布"** (Apply for Release)
5. The org admin receives a review request — they approve in the Admin Console
6. Once approved, the bot becomes available in the organization

### Step 8: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> \\
  --platform feishu \\
  --app-id <appId> \\
  --app-secret <appSecret>

# Optional: with webhook verification
lh bot add -a <agentId> \\
  --platform feishu \\
  --app-id <appId> \\
  --app-secret <appSecret> \\
  --verification-token <token> \\
  --encrypt-key <key>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Notes

- **WebSocket mode** (长连接) skips the need for a public URL and is the fastest to set up
- Every change to permissions, events, or app info requires creating a new version and re-publishing
- \`im.message.receive_v1\` is the key event — without it the bot receives no messages
- Feishu does not render Markdown — use plain text or Feishu's card format for rich messages
- The App Secret is sensitive; rotate it in the console if compromised (old secret stops working immediately)
`;

export default content;
