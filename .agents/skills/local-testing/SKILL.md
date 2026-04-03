---
name: local-testing
description: >
  Local app and bot testing. Uses agent-browser CLI for Electron/web app UI testing,
  and osascript (AppleScript) for controlling native macOS apps (WeChat, Discord, Telegram, Slack, Lark/飞书, QQ)
  to test bots. Triggers on 'local test', 'test in electron', 'test desktop', 'test bot',
  'bot test', 'test in discord', 'test in telegram', 'test in slack', 'test in weixin',
  'test in wechat', 'test in lark', 'test in feishu', 'test in qq',
  'manual test', 'osascript', or UI/bot verification tasks.
---

# Local App & Bot Testing

Two approaches for local testing on macOS:

| Approach                    | Tool                | Best For                                             |
| --------------------------- | ------------------- | ---------------------------------------------------- |
| **agent-browser + CDP**     | `agent-browser` CLI | Electron apps, web apps (DOM access, JS eval)        |
| **osascript (AppleScript)** | `osascript -e`      | Native macOS apps (WeChat, Discord, Telegram, Slack) |

---

# Part 1: agent-browser (Electron / Web Apps)

Use `agent-browser` to automate Chromium-based apps via Chrome DevTools Protocol.

Install via `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`. Run `agent-browser install` to download Chrome. Run `agent-browser upgrade` to update.

## Core Workflow

Every browser automation follows this pattern:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: Use refs to click, fill, select
4. **Re-snapshot**: After navigation or DOM changes, get fresh refs

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Command Chaining

```bash
# Chain open + wait + snapshot in one call
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
```

Use `&&` when you don't need to read intermediate output. Run commands separately when you need to parse output first (e.g., snapshot to discover refs, then interact).

## Essential Commands

```bash
# Navigation
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser
agent-browser close --all             # Close all active sessions

# Snapshot
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -s "#selector" # Scope to CSS selector

# Interaction (use @refs from snapshot)
agent-browser click @e1               # Click element
agent-browser click @e1 --new-tab     # Click and open in new tab
agent-browser fill @e2 "text"         # Clear and type text
agent-browser type @e2 "text"         # Type without clearing
agent-browser select @e1 "option"     # Select dropdown option
agent-browser check @e1               # Check checkbox
agent-browser press Enter             # Press key
agent-browser keyboard type "text"    # Type at current focus (no selector)
agent-browser keyboard inserttext "text"  # Insert without key events
agent-browser scroll down 500         # Scroll page
agent-browser scroll down 500 --selector "div.content"  # Scroll within container

# Get information
agent-browser get text @e1            # Get element text
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title
agent-browser get cdp-url             # Get CDP WebSocket URL

# Wait
agent-browser wait @e1                # Wait for element
agent-browser wait --load networkidle # Wait for network idle
agent-browser wait --url "**/page"    # Wait for URL pattern
agent-browser wait 2000               # Wait milliseconds
agent-browser wait --text "Welcome"   # Wait for text to appear
agent-browser wait --fn "!document.body.innerText.includes('Loading...')"  # Wait for text to disappear
agent-browser wait "#spinner" --state hidden  # Wait for element to disappear

# Downloads
agent-browser download @e1 ./file.pdf          # Click element to trigger download
agent-browser wait --download ./output.zip     # Wait for any download to complete

# Network
agent-browser network requests                 # Inspect tracked requests
agent-browser network requests --type xhr,fetch  # Filter by resource type
agent-browser network requests --method POST   # Filter by HTTP method
agent-browser network route "**/api/*" --abort # Block matching requests
agent-browser network har start                # Start HAR recording
agent-browser network har stop ./capture.har   # Stop and save HAR file

# Viewport & Device Emulation
agent-browser set viewport 1920 1080          # Set viewport size (default: 1280x720)
agent-browser set viewport 1920 1080 2        # 2x retina
agent-browser set device "iPhone 14"          # Emulate device (viewport + user agent)

# Capture
agent-browser screenshot              # Screenshot to temp dir
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf          # Save as PDF

# Clipboard
agent-browser clipboard read          # Read text from clipboard
agent-browser clipboard write "text"  # Write text to clipboard
agent-browser clipboard copy          # Copy current selection
agent-browser clipboard paste         # Paste from clipboard

# Dialogs (alert, confirm, prompt, beforeunload)
agent-browser dialog accept           # Accept dialog
agent-browser dialog accept "input"   # Accept prompt dialog with text
agent-browser dialog dismiss          # Dismiss/cancel dialog
agent-browser dialog status           # Check if dialog is open

# Diff (compare page states)
agent-browser diff snapshot                        # Compare current vs last snapshot
agent-browser diff screenshot --baseline before.png  # Visual pixel diff
agent-browser diff url <url1> <url2>               # Compare two pages

# Streaming
agent-browser stream enable           # Start WebSocket streaming
agent-browser stream status           # Inspect streaming state
agent-browser stream disable          # Stop streaming
```

## Batch Execution

```bash
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json
```

## Authentication

```bash
# Option 1: Auth vault (credentials stored encrypted)
echo "$PASSWORD" | agent-browser auth save myapp --url https://app.example.com/login --username user --password-stdin
agent-browser auth login myapp

# Option 2: Session name (auto-save/restore cookies + localStorage)
agent-browser --session-name myapp open https://app.example.com/login
agent-browser close  # State auto-saved
agent-browser --session-name myapp open https://app.example.com/dashboard  # Auto-restored

# Option 3: Persistent profile
agent-browser --profile ~/.myapp open https://app.example.com/login

# Option 4: State file
agent-browser state save auth.json
agent-browser state load auth.json
```

## Semantic Locators (Alternative to Refs)

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
```

## JavaScript Evaluation (eval)

```bash
# Simple expressions
agent-browser eval 'document.title'

# Complex JS: use --stdin with heredoc (RECOMMENDED)
agent-browser eval --stdin <<'EVALEOF'
JSON.stringify(
  Array.from(document.querySelectorAll("img"))
    .filter(i => !i.alt)
    .map(i => ({ src: i.src.split("/").pop(), width: i.width }))
)
EVALEOF

# Base64 encoding (avoids all shell escaping issues)
agent-browser eval -b "$(echo -n 'document.title' | base64)"
```

## Ref Lifecycle

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot after clicking links/buttons that navigate, form submissions, or dynamic content loading.

## Annotated Screenshots (Vision Mode)

```bash
agent-browser screenshot --annotate
# Output includes the image path and a legend:
#   [1] @e1 button "Submit"
#   [2] @e2 link "Home"
agent-browser click @e2  # Click using ref from annotated screenshot
```

## Parallel Sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com
agent-browser session list
```

## Connect to Existing Chrome

```bash
agent-browser --auto-connect snapshot            # Auto-discover running Chrome
agent-browser --cdp 9222 snapshot                # Explicit CDP port
```

## iOS Simulator (Mobile Safari)

```bash
agent-browser device list
agent-browser -p ios --device "iPhone 16 Pro" open https://example.com
agent-browser -p ios snapshot -i
agent-browser -p ios tap @e1
agent-browser -p ios swipe up
agent-browser -p ios screenshot mobile.png
agent-browser -p ios close
```

## Observability Dashboard

```bash
agent-browser dashboard install
agent-browser dashboard start      # Background server on port 4848
agent-browser dashboard stop
```

## Cloud Providers

Use `-p <provider>` to run against cloud browsers: `agentcore`, `browserbase`, `browserless`, `browseruse`, `kernel`.

## Browser Engine Selection

```bash
agent-browser --engine lightpanda open example.com   # 10x faster, 10x less memory
```

## Electron (LobeHub Desktop)

### Setup

```bash
# 1. Kill existing instances
pkill -f "Electron" 2> /dev/null
pkill -f "electron-vite" 2> /dev/null
pkill -f "agent-browser" 2> /dev/null
sleep 3

# 2. Start Electron with CDP (MUST cd to apps/desktop first)
cd apps/desktop && ELECTRON_ENABLE_LOGGING=1 npx electron-vite dev -- --remote-debugging-port=9222 > /tmp/electron-dev.log 2>&1 &

# 3. Wait for startup
for i in $(seq 1 12); do
  sleep 5
  if strings /tmp/electron-dev.log 2> /dev/null | grep -q "starting electron"; then
    echo "ready"
    break
  fi
done

# 4. Wait for renderer, then connect
sleep 15 && agent-browser --cdp 9222 wait 3000
```

**Critical:** `npx electron-vite dev` MUST run from `apps/desktop/` directory, not project root.

### LobeHub-Specific Patterns

#### Access Zustand Store State

```bash
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function() {
  var chat = window.__LOBE_STORES.chat();
  var ops = Object.values(chat.operations);
  return JSON.stringify({
    ops: ops.map(function(o) { return { type: o.type, status: o.status }; }),
    activeAgent: chat.activeAgentId,
    activeTopic: chat.activeTopicId,
  });
})()
EVALEOF
```

#### Find and Use the Chat Input

```bash
# The chat input is contenteditable — must use -C flag
agent-browser --cdp 9222 snapshot -i -C 2>&1 | grep "editable"

agent-browser --cdp 9222 click @e48
agent-browser --cdp 9222 type @e48 "Hello world"
agent-browser --cdp 9222 press Enter
```

#### Wait for Agent to Complete

```bash
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function() {
  var chat = window.__LOBE_STORES.chat();
  var ops = Object.values(chat.operations);
  var running = ops.filter(function(o) { return o.status === 'running'; });
  return running.length === 0 ? 'done' : 'running: ' + running.length;
})()
EVALEOF
```

#### Install Error Interceptor

```bash
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function() {
  window.__CAPTURED_ERRORS = [];
  var orig = console.error;
  console.error = function() {
    var msg = Array.from(arguments).map(function(a) {
      if (a instanceof Error) return a.message;
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' ');
    window.__CAPTURED_ERRORS.push(msg);
    orig.apply(console, arguments);
  };
  return 'installed';
})()
EVALEOF

# Later, check captured errors:
agent-browser --cdp 9222 eval "JSON.stringify(window.__CAPTURED_ERRORS)"
```

## Chrome / Web Apps

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-test-profile \
  "<URL>" &
sleep 5
agent-browser --cdp 9222 snapshot -i

# Or auto-discover running Chrome with remote debugging
agent-browser --auto-connect snapshot -i
```

---

# Part 2: osascript (Native macOS App Bot Testing)

Use AppleScript via `osascript` to control native macOS desktop apps for bot testing. This works with any app that supports macOS Accessibility, without needing CDP or Chromium.

## Core osascript Patterns

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

## Client: Discord

**App name:** `Discord` | **Process name:** `Discord`

### Activate & Navigate

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

### Send Message to Bot

```bash
# The message input is focused after navigating to a channel
# Type a message
osascript -e 'tell application "System Events" to keystroke "/hello"'
sleep 0.5
osascript -e 'tell application "System Events" to key code 36' # Enter
```

### Send Long Message (via clipboard)

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

### Verify Bot Response

```bash
# Wait for bot to respond, then screenshot
sleep 10
screencapture /tmp/discord-bot-response.png
# Read with the Read tool for visual verification
```

### Full Bot Test Example

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

---

## Client: Slack

**App name:** `Slack` | **Process name:** `Slack`

### Activate & Navigate

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

### Send Message to Bot

```bash
# Direct message input (focused after channel nav)
osascript -e 'tell application "System Events" to keystroke "@mybot hello"'
sleep 0.3
osascript -e 'tell application "System Events" to key code 36'
```

### Send Long Message

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

### Slash Command Test

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

### Verify Response

```bash
sleep 10
screencapture /tmp/slack-bot-response.png
```

---

## Client: Telegram

**App name:** `Telegram` | **Process name:** `Telegram`

### Activate & Navigate

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

### Send Message to Bot

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

### Send Long Message

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

### Verify Response

```bash
sleep 10
screencapture /tmp/telegram-bot-response.png
```

### Telegram Bot API (programmatic alternative)

For sending messages directly to the bot's chat without UI:

```bash
# Send message as the bot (for testing webhooks/responses)
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$CHAT_ID&text=test message"

# Get recent updates
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates?limit=5" | jq .
```

---

## Client: WeChat / 微信

**App name:** `微信` or `WeChat` | **Process name:** `WeChat`

### Activate & Navigate

```bash
# Activate WeChat
osascript -e 'tell application "微信" to activate'
sleep 1

# Search for a contact/bot (Cmd+F)
osascript -e '
tell application "System Events"
    keystroke "f" using command down
    delay 0.5
    keystroke "TestBot"
    delay 1
    key code 36  -- Enter to select
end tell
'
sleep 2
```

### Send Message

```bash
# After navigating to a chat, the input is focused
osascript -e '
tell application "System Events"
    keystroke "Hello bot!"
    delay 0.3
    key code 36
end tell
'
```

### Send Long Message (clipboard)

```bash
osascript -e '
tell application "微信" to activate
delay 0.5
set the clipboard to "Please help me with this task..."
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36
end tell
'
```

### Verify Response

```bash
sleep 10
screencapture /tmp/wechat-bot-response.png
```

### WeChat-Specific Notes

- WeChat macOS app name can be `微信` or `WeChat` depending on system language. Try both:
  ```bash
  osascript -e 'tell application "微信" to activate' 2> /dev/null \
    || osascript -e 'tell application "WeChat" to activate'
  ```
- WeChat uses **Enter** to send (not Cmd+Enter by default, but configurable)
- For multi-line messages without sending, use **Shift+Enter**:
  ```bash
  osascript -e 'tell application "System Events" to key code 36 using shift down'
  ```

---

## Client: Lark / 飞书

**App name:** `Lark` or `飞书` | **Process name:** `Lark` or `飞书`

### Activate & Navigate

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

### Send Message to Bot

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

### Verify Response

```bash
sleep 10
screencapture /tmp/lark-bot-response.png
```

### Lark-Specific Notes

- App name varies: `Lark` (international) vs `飞书` (China mainland) — the script auto-detects
- Uses `Cmd+K` for quick search (same as Discord/Slack)
- Enter sends message by default

---

## Client: QQ

**App name:** `QQ` | **Process name:** `QQ`

### Activate & Navigate

```bash
osascript -e 'tell application "QQ" to activate'
sleep 1

# Search for contact/group (Cmd+F)
osascript -e '
tell application "System Events"
    keystroke "f" using command down
    delay 0.8
end tell
'
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

### Send Message to Bot

```bash
osascript -e '
set the clipboard to "Hello bot!"
tell application "System Events"
    keystroke "v" using command down
    delay 0.3
    key code 36  -- Enter
end tell
'
```

### Verify Response

```bash
sleep 10
screencapture /tmp/qq-bot-response.png
```

### QQ-Specific Notes

- Enter sends message by default; Shift+Enter for newlines
- Uses `Cmd+F` for search
- Always use clipboard paste for CJK characters

---

## Common Bot Testing Workflow (osascript)

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

# Scripts

Ready-to-use scripts in `.agents/skills/local-testing/scripts/`:

| Script                    | Usage                                         |
| ------------------------- | --------------------------------------------- |
| `capture-app-window.sh`   | Capture screenshot of a specific app window   |
| `record-electron-demo.sh` | Record Electron app demo with ffmpeg          |
| `test-discord-bot.sh`     | Send message to Discord bot via osascript     |
| `test-slack-bot.sh`       | Send message to Slack bot via osascript       |
| `test-telegram-bot.sh`    | Send message to Telegram bot via osascript    |
| `test-wechat-bot.sh`      | Send message to WeChat bot via osascript      |
| `test-lark-bot.sh`        | Send message to Lark / 飞书 bot via osascript |
| `test-qq-bot.sh`          | Send message to QQ bot via osascript          |

### Window Screenshot Utility

`capture-app-window.sh` captures a screenshot of a specific app window using `screencapture -l <windowID>`. It uses Swift + CGWindowList to find the window by process name, so screenshots work correctly even when the window is on an external monitor or behind other windows.

```bash
# Standalone usage
./.agents/skills/local-testing/scripts/capture-app-window.sh "Discord" /tmp/discord.png
./.agents/skills/local-testing/scripts/capture-app-window.sh "Slack" /tmp/slack.png
./.agents/skills/local-testing/scripts/capture-app-window.sh "WeChat" /tmp/wechat.png
```

All bot test scripts use this utility automatically for their screenshots.

### Bot Test Scripts

All bot test scripts share the same interface:

```bash
./scripts/test-<platform>-bot.sh <channel_or_contact> <message> [wait_seconds] [screenshot_path]
```

Examples:

```bash
# Discord — test a bot in #bot-testing channel
./.agents/skills/local-testing/scripts/test-discord-bot.sh "bot-testing" "!ping"
./.agents/skills/local-testing/scripts/test-discord-bot.sh "bot-testing" "/ask Tell me a joke" 30

# Slack — test a bot in #bot-testing channel
./.agents/skills/local-testing/scripts/test-slack-bot.sh "bot-testing" "@mybot hello"
./.agents/skills/local-testing/scripts/test-slack-bot.sh "bot-testing" "/ask What is 2+2?" 20

# Telegram — test a bot by username
./.agents/skills/local-testing/scripts/test-telegram-bot.sh "MyTestBot" "/start"
./.agents/skills/local-testing/scripts/test-telegram-bot.sh "GPTBot" "Hello" 60

# WeChat — test a bot or send to a contact
./.agents/skills/local-testing/scripts/test-wechat-bot.sh "文件传输助手" "test message" 5
./.agents/skills/local-testing/scripts/test-wechat-bot.sh "MyBot" "Tell me a joke" 30

# Lark/飞书 — test a bot in a group chat
./.agents/skills/local-testing/scripts/test-lark-bot.sh "bot-testing" "@MyBot hello"
./.agents/skills/local-testing/scripts/test-lark-bot.sh "bot-testing" "Help me with this" 30

# QQ — test a bot in a group or direct chat
./.agents/skills/local-testing/scripts/test-qq-bot.sh "bot-testing" "Hello bot" 15
./.agents/skills/local-testing/scripts/test-qq-bot.sh "MyBot" "/help" 10
```

Each script: activates the app, navigates to the channel/contact, pastes the message via clipboard, sends, waits, and takes a screenshot. Use the `Read` tool on the screenshot for visual verification.

---

# Screen Recording

Record automated demos by combining `ffmpeg` screen capture with `agent-browser` automation. The script `.agents/skills/local-testing/scripts/record-electron-demo.sh` handles the full lifecycle for Electron.

### Usage

```bash
# Run the built-in demo (queue-edit feature)
./.agents/skills/local-testing/scripts/record-electron-demo.sh

# Run a custom automation script
./.agents/skills/local-testing/scripts/record-electron-demo.sh ./my-demo.sh /tmp/my-demo.mp4
```

The script automatically:

1. Starts Electron with CDP and waits for SPA to load
2. Detects window position, screen, and Retina scale via Swift/CGWindowList
3. Records only the Electron window region using `ffmpeg -f avfoundation` with crop
4. Runs the demo (built-in or custom script receiving CDP port as `$1`)
5. Stops recording and cleans up

---

# Gotchas

### agent-browser

- **Daemon can get stuck** — if commands hang, `agent-browser close --all` or `pkill -f agent-browser` to reset
- **HMR invalidates everything** — after code changes, refs break. Re-snapshot or restart
- **`snapshot -i` doesn't find contenteditable** — use `snapshot -i -C` for rich text editors
- **`fill` doesn't work on contenteditable** — use `type` for chat inputs
- **Screenshots go to `~/.agent-browser/tmp/screenshots/`** — read them with the `Read` tool
- **Dialogs block all commands** — if commands time out, check `agent-browser dialog status`
- **Default timeout is 25s** — override with `AGENT_BROWSER_DEFAULT_TIMEOUT` (ms) or use explicit waits
- **Shell quoting corrupts eval** — use `eval --stdin <<'EVALEOF'` for complex JS

### Electron-specific

- **`npx electron-vite dev` must run from `apps/desktop/`** — running from project root fails silently
- **Don't resize the Electron window after load** — resizing triggers full SPA reload
- **Store is at `window.__LOBE_STORES`** not `window.__ZUSTAND_STORES__`

### osascript

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
