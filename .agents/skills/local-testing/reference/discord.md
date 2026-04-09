# Discord Bot Testing

**App name:** `Discord` | **Process name:** `Discord`

See [osascript-common.md](./osascript-common.md) for shared patterns.

## Activate & Navigate

```bash
# Activate Discord
osascript -e 'tell application "Discord" to activate'
sleep 1

# Open Quick Switcher (Cmd+K) to navigate to a channel
osascript -e 'tell application "System Events" to keystroke "k" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "bot-testing"'
sleep 1
osascript -e 'tell application "System Events" to key code 36' # Enter
sleep 2
```

## Send Message to Bot

```bash
# The message input is focused after navigating to a channel
# Type a message
osascript -e 'tell application "System Events" to keystroke "/hello"'
sleep 0.5
osascript -e 'tell application "System Events" to key code 36' # Enter
```

## Send Long Message (via clipboard)

```bash
osascript -e '
tell application "Discord" to activate
delay 0.5
set the clipboard to "Write a 3000 word essay about space exploration"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36  -- Enter
end tell
'
```

## Verify Bot Response

```bash
# Wait for bot to respond, then screenshot
sleep 10
screencapture /tmp/discord-bot-response.png
# Read with the Read tool for visual verification
```

## Full Bot Test Example

```bash
#!/usr/bin/env bash
# test-discord-bot.sh — Send message and verify bot response

# 1. Activate Discord and navigate to channel
osascript -e '
tell application "Discord" to activate
delay 1
-- Quick Switcher
tell application "System Events" to keystroke "k" using command down
delay 0.5
tell application "System Events" to keystroke "bot-testing"
delay 1
tell application "System Events" to key code 36
delay 2
'

# 2. Send test message
osascript -e '
set the clipboard to "!ping"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'

# 3. Wait for response and capture
sleep 5
screencapture /tmp/discord-test-result.png
echo "Screenshot saved to /tmp/discord-test-result.png"
```

## Script

```bash
./.agents/skills/local-testing/scripts/test-discord-bot.sh "bot-testing" "!ping"
./.agents/skills/local-testing/scripts/test-discord-bot.sh "bot-testing" "/ask Tell me a joke" 30
```
