# Telegram Bot Testing

**App name:** `Telegram` | **Process name:** `Telegram`

See [osascript-common.md](./osascript-common.md) for shared patterns.

## Activate & Navigate

```bash
# Activate Telegram
osascript -e 'tell application "Telegram" to activate'
sleep 1

# Search for a bot (Cmd+F or click search)
osascript -e '
tell application "System Events"
    keystroke "f" using command down
    delay 0.5
    keystroke "MyTestBot"
    delay 1
    key code 36  -- Enter to select
end tell
'
sleep 2
```

## Send Message to Bot

```bash
# After navigating to bot chat, input is focused
osascript -e '
tell application "System Events"
    keystroke "/start"
    delay 0.3
    key code 36
end tell
'
```

## Send Long Message

```bash
osascript -e '
tell application "Telegram" to activate
delay 0.5
set the clipboard to "Tell me about quantum computing in detail"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'
```

## Verify Response

```bash
sleep 10
screencapture /tmp/telegram-bot-response.png
```

## Telegram Bot API (programmatic alternative)

For sending messages directly to the bot's chat without UI:

```bash
# Send message as the bot (for testing webhooks/responses)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$CHAT_ID&text=test message"

# Get recent updates
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates?limit=5" | jq .
```

## Script

```bash
./.agents/skills/local-testing/scripts/test-telegram-bot.sh "MyTestBot" "/start"
./.agents/skills/local-testing/scripts/test-telegram-bot.sh "GPTBot" "Hello" 60
```
