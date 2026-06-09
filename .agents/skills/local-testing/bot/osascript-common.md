# osascript Common Patterns

Shared AppleScript / `osascript` patterns used by all platform bot tests. Read this first, then refer to the per-platform file for app-specific quirks.

## Core Patterns

### Activate an App

```bash
osascript -e 'tell application "Discord" to activate'
```

### Type Text

```bash
# Type character by character (reliable, but slow for long text)
osascript -e 'tell application "System Events" to keystroke "Hello world"'

# Press Enter
osascript -e 'tell application "System Events" to key code 36'

# Press Tab
osascript -e 'tell application "System Events" to key code 48'

# Press Escape
osascript -e 'tell application "System Events" to key code 53'
```

### Paste from Clipboard (fast, for long text)

```bash
# Set clipboard and paste — much faster than keystroke for long messages
osascript -e 'set the clipboard to "Your long message here"'
osascript -e 'tell application "System Events" to keystroke "v" using command down'
```

Or in one shot:

```bash
osascript -e '
set the clipboard to "Your long message here"
tell application "System Events" to keystroke "v" using command down
'
```

### Keyboard Shortcuts

```bash
# Cmd+K (quick switcher in Discord/Slack)
osascript -e 'tell application "System Events" to keystroke "k" using command down'

# Cmd+F (search)
osascript -e 'tell application "System Events" to keystroke "f" using command down'

# Cmd+N (new message/chat)
osascript -e 'tell application "System Events" to keystroke "n" using command down'

# Cmd+Shift+K (example: multi-modifier)
osascript -e 'tell application "System Events" to keystroke "k" using {command down, shift down}'
```

### Click at Position

```bash
# Click at absolute screen coordinates
osascript -e '
tell application "System Events"
    click at {500, 300}
end tell
'
```

### Get Window Info

```bash
# Get window position and size
osascript -e '
tell application "System Events"
    tell process "Discord"
        get {position, size} of window 1
    end tell
end tell
'
```

### Screenshot

```bash
# Full screen
screencapture /tmp/screenshot.png

# Interactive region select
screencapture -i /tmp/screenshot.png

# Specific window (by window ID from CGWindowList)
screencapture -l < WINDOW_ID > /tmp/screenshot.png
```

To get window ID for a specific app:

```bash
osascript -e '
tell application "System Events"
    tell process "Discord"
        get id of window 1
    end tell
end tell
'
```

### Read Accessibility Elements

```bash
# Get all UI elements of the frontmost window (can be slow/large)
osascript -e '
tell application "System Events"
    tell process "Discord"
        entire contents of window 1
    end tell
end tell
'

# Get a specific element's value
osascript -e '
tell application "System Events"
    tell process "Discord"
        get value of text field 1 of window 1
    end tell
end tell
'
```

> **Warning:** `entire contents` can be extremely slow on complex UIs. Prefer screenshots + `Read` tool for visual verification.

### Read Screen Text via Clipboard

For reading the latest message or response from an app:

```bash
# Select all text in the focused area and copy
osascript -e '
tell application "System Events"
    keystroke "a" using command down
    keystroke "c" using command down
end tell
'
sleep 0.5
# Read clipboard
pbpaste
```

---

## Common Bot Testing Workflow

Regardless of platform, the pattern is:

```bash
APP_NAME="Discord" # or "Slack", "Telegram", "微信"
CHANNEL="bot-testing"
MESSAGE="Hello bot!"
WAIT_SECONDS=10

# 1. Activate
osascript -e "tell application \"$APP_NAME\" to activate"
sleep 1

# 2. Navigate to channel/chat (via Quick Switcher or Search)
osascript -e 'tell application "System Events" to keystroke "k" using command down'
sleep 0.5
osascript -e "tell application \"System Events\" to keystroke \"$CHANNEL\""
sleep 1
osascript -e 'tell application "System Events" to key code 36'
sleep 2

# 3. Send message
osascript -e "set the clipboard to \"$MESSAGE\""
osascript -e '
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'

# 4. Wait for bot response
sleep "$WAIT_SECONDS"

# 5. Screenshot for verification
screencapture /tmp/"${APP_NAME,,}"-bot-test.png
echo "Result saved to /tmp/${APP_NAME,,}-bot-test.png"
```

### Tips

- **Use clipboard paste** (`Cmd+V`) for messages containing special characters or long text — `keystroke` can mangle non-ASCII
- **Add `delay`** between actions — apps need time to process UI events
- **Screenshot for verification** — use `screencapture` + `Read` tool for visual checks
- **Use a dedicated test channel/chat** — avoid polluting real conversations
- **Check app name** — some apps have different names in different locales (e.g., `微信` vs `WeChat`)
- **Accessibility permissions required** — System Events automation requires granting Accessibility access in System Preferences > Privacy & Security > Accessibility

---

## Gotchas

- **Accessibility permission required** — first run will prompt for access; grant it in System Preferences > Privacy & Security > Accessibility for Terminal / iTerm / Claude Code
- **`keystroke` is slow for long text** — always use clipboard paste (`Cmd+V`) for messages over \~20 characters
- **`keystroke` can mangle non-ASCII** — use clipboard paste for Chinese, emoji, or special characters
- **`key code 36` is Enter** — this is the hardware key code, works regardless of keyboard layout
- **`entire contents` is extremely slow** — avoid for complex UIs; use screenshots instead
- **App name varies by locale** — `微信` vs `WeChat`, `企业微信` vs `WeCom`; handle both
- **WeChat Enter sends immediately** — use `Shift+Enter` for newlines within a message
- **Rate limiting** — don't send messages too fast; platforms may throttle or flag automated input
- **Lark / 飞书 app name varies** — `Lark` (international) vs `飞书` (China mainland); scripts auto-detect
- **QQ uses `Cmd+F` for search** — not `Cmd+K` like Discord/Slack/Lark
- **Bot response times vary** — AI-powered bots may take 10-60s; use generous sleep values
