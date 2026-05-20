# Slack Bot Testing

**App name:** `Slack` | **Process name:** `Slack`

See [osascript-common.md](./osascript-common.md) for shared patterns.

## Activate & Navigate

```bash
# Activate Slack
osascript -e 'tell application "Slack" to activate'
sleep 1

# Quick Switcher (Cmd+K)
osascript -e 'tell application "System Events" to keystroke "k" using command down'
sleep 0.5
osascript -e 'tell application "System Events" to keystroke "bot-testing"'
sleep 1
osascript -e 'tell application "System Events" to key code 36' # Enter
sleep 2
```

## Send Message to Bot

```bash
# Direct message input (focused after channel nav)
osascript -e 'tell application "System Events" to keystroke "@mybot hello"'
sleep 0.3
osascript -e 'tell application "System Events" to key code 36'
```

## Send Long Message

```bash
osascript -e '
tell application "Slack" to activate
delay 0.5
set the clipboard to "A long test message for the bot..."
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'
```

## Slash Command Test

```bash
osascript -e '
tell application "Slack" to activate
delay 0.5
tell application "System Events"
    keystroke "/ask What is the meaning of life?"
    delay 0.5
    key code 36
end tell
'
```

## Verify Response

```bash
sleep 10
screencapture /tmp/slack-bot-response.png
```

## Script

```bash
./.agents/skills/local-testing/scripts/test-slack-bot.sh "bot-testing" "@mybot hello"
./.agents/skills/local-testing/scripts/test-slack-bot.sh "bot-testing" "/ask What is 2+2?" 20
```
