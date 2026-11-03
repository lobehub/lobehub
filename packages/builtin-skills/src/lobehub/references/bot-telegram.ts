const content = `# Telegram Bot Setup Guide

Connect a Telegram bot to your agent.

**Bot Creation:** https://t.me/BotFather

## Required Credentials

| Field | Required | Description |
|-------|----------|-------------|
| Bot Token | Yes | Authentication token from BotFather |
| Secret Token | No | Custom token for webhook request verification |

## Step-by-Step Setup

### Step 1: Create a Bot via BotFather

1. Open Telegram and search for **@BotFather** (verified with blue checkmark)
2. Send the command: \`/newbot\`
3. BotFather will ask for:
   - **Bot name** — display name (e.g., "My Assistant")
   - **Bot username** — must end in \`bot\` (e.g., \`myassistant_bot\`)
4. BotFather replies with the **Bot Token** in the format \`1234567890:ABCdef...\`
   > Save this token — you can retrieve it later with \`/token\` in BotFather

### Step 2: (Optional) Configure Bot Behavior

Send commands to @BotFather to adjust settings:

- \`/setprivacy\` → select your bot → **Disable** — allows bot to see all group messages (not just commands)
- \`/setjoingroups\` → **Enable** — allows the bot to be added to groups
- \`/setcommands\` → define command list shown in Telegram's menu UI
- \`/setdescription\` → set the bot's description shown on the profile page
- \`/setuserpic\` → set the bot's avatar

### Step 3: Get the Bot's Numeric ID (for --app-id)

The Bot Token has the format \`1234567890:ABCdef...\` — the numeric part before the colon is the bot's ID. Use it as \`--app-id\`.

Alternatively, send \`/mybots\` to @BotFather → select your bot → **API Token** to see the full token again.

### Step 4: Connect via CLI

\`\`\`bash
lh bot add -a <agentId> \\
  --platform telegram \\
  --app-id <numericBotId> \\
  --bot-token <botToken>

lh bot test <botId>
lh bot connect <botId>
\`\`\`

## Notes

- **App ID** is the numeric bot ID extracted from the token prefix (e.g. token \`987654321:XYZ...\` → app-id \`987654321\`)
- **Secret Token** (optional): a custom string you define; LobeHub includes it in webhook requests so you can verify they genuinely come from LobeHub — leave blank unless you have a security requirement
- Telegram does not have native message search; use \`lh bot message read\` with pagination instead
- If you lose the token, retrieve it by sending \`/token\` (then select your bot) to @BotFather
`;

export default content;
