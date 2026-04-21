# Lark / 飞书 Bot Testing

**App name:** `Lark` or `飞书` | **Process name:** `Lark` or `飞书`

See [osascript-common.md](./osascript-common.md) for shared patterns.

## Activate & Navigate

```bash
# Activate Lark (auto-detects Lark or 飞书)
osascript -e 'tell application "Lark" to activate' 2> /dev/null \
  || osascript -e 'tell application "飞书" to activate'
sleep 1

# Quick Switcher / Search (Cmd+K)
osascript -e 'tell application "System Events" to keystroke "k" using command down'
sleep 0.5
osascript -e '
set the clipboard to "bot-testing"
tell application "System Events"
    keystroke "v" using command down
    delay 1.5
    key code 36  -- Enter
end tell
'
sleep 2
```

## Send Message to Bot

```bash
osascript -e '
set the clipboard to "@MyBot help me with this task"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36  -- Enter
end tell
'
```

## Verify Response

```bash
sleep 10
screencapture /tmp/lark-bot-response.png
```

## Lark-Specific Notes

- App name varies: `Lark` (international) vs `飞书` (China mainland) — the script auto-detects
- Uses `Cmd+K` for quick search (same as Discord/Slack)
- Enter sends message by default
- Always use clipboard paste for CJK characters

## Script

```bash
./.agents/skills/local-testing/scripts/test-lark-bot.sh "bot-testing" "@MyBot hello"
./.agents/skills/local-testing/scripts/test-lark-bot.sh "bot-testing" "Help me with this" 30
```
