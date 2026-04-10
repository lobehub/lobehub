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
agent-browser snapshot -i # Check result
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
agent-browser close                                                       # State auto-saved
agent-browser --session-name myapp open https://app.example.com/dashboard # Auto-restored

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
agent-browser eval --stdin << 'EVALEOF'
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
agent-browser click @e2 # Click using ref from annotated screenshot
```

## Parallel Sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com
agent-browser session list
```

## Connect to Existing Chrome

```bash
agent-browser --auto-connect snapshot # Auto-discover running Chrome
agent-browser --cdp 9222 snapshot     # Explicit CDP port
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
agent-browser dashboard start # Background server on port 4848
agent-browser dashboard stop
```

## Cloud Providers

Use `-p <provider>` to run against cloud browsers: `agentcore`, `browserbase`, `browserless`, `browseruse`, `kernel`.

## Browser Engine Selection

```bash
agent-browser --engine lightpanda open example.com # 10x faster, 10x less memory
```

## Electron (LobeHub Desktop)

### Setup / Teardown

Use the `electron-dev.sh` script to manage the Electron dev environment. It handles process lifecycle, waits for SPA readiness, and reliably kills all child processes (main + helpers + vite).

```bash
SCRIPT=".agents/skills/local-testing/scripts/electron-dev.sh"

# Start Electron dev with CDP (idempotent — skips if already running)
$SCRIPT start

# Check if Electron is running and CDP is reachable
$SCRIPT status

# Kill all Electron-related processes (main + helper + vite)
$SCRIPT stop

# Force fresh restart
$SCRIPT restart
```

After `start` succeeds, connect with: `agent-browser --cdp 9222 snapshot -i`

**Always run `$SCRIPT stop` when done testing** — `pkill -f "Electron"` alone won't catch all helper processes.

#### Environment Variables

| Variable          | Default                 | Description                              |
| ----------------- | ----------------------- | ---------------------------------------- |
| `CDP_PORT`        | `9222`                  | Chrome DevTools Protocol port            |
| `ELECTRON_LOG`    | `/tmp/electron-dev.log` | Electron process log                     |
| `ELECTRON_WAIT_S` | `60`                    | Max seconds to wait for Electron process |
| `RENDERER_WAIT_S` | `60`                    | Max seconds to wait for SPA to load      |

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

Use AppleScript via `osascript` to control native macOS desktop apps for bot testing. Works with any app that supports macOS Accessibility, no CDP or Chromium needed.

The pattern is the same for every platform:

1. **Activate** the app (`tell application "X" to activate`)
2. **Navigate** to a channel/chat (Quick Switcher `Cmd+K` or Search `Cmd+F`)
3. **Send** a message (clipboard paste `Cmd+V` + Enter)
4. **Wait** for the bot response
5. **Screenshot** for verification (`screencapture` + `Read` tool)

## Per-Platform References

Pick the file for your target platform — each contains activation, navigation, send-message, and verification snippets specific to that app:

| Platform      | Reference                                        | Quick switcher |
| ------------- | ------------------------------------------------ | -------------- |
| Discord       | [reference/discord.md](./reference/discord.md)   | `Cmd+K`        |
| Slack         | [reference/slack.md](./reference/slack.md)       | `Cmd+K`        |
| Telegram      | [reference/telegram.md](./reference/telegram.md) | `Cmd+F`        |
| WeChat / 微信 | [reference/wechat.md](./reference/wechat.md)     | `Cmd+F`        |
| Lark / 飞书   | [reference/lark.md](./reference/lark.md)         | `Cmd+K`        |
| QQ            | [reference/qq.md](./reference/qq.md)             | `Cmd+F`        |

For **shared osascript patterns** (activate, type, paste, screenshot, read accessibility, common workflow template, gotchas), see [reference/osascript-common.md](./reference/osascript-common.md). Read this first if you're new to osascript automation.

---

# Scripts

Ready-to-use scripts in `.agents/skills/local-testing/scripts/`:

| Script                    | Usage                                               |
| ------------------------- | --------------------------------------------------- |
| `electron-dev.sh`         | Manage Electron dev env (start/stop/status/restart) |
| `capture-app-window.sh`   | Capture screenshot of a specific app window         |
| `record-electron-demo.sh` | Record Electron app demo with ffmpeg                |
| `record-app-screen.sh`    | Record app screen (video + screenshots, start/stop) |
| `test-discord-bot.sh`     | Send message to Discord bot via osascript           |
| `test-slack-bot.sh`       | Send message to Slack bot via osascript             |
| `test-telegram-bot.sh`    | Send message to Telegram bot via osascript          |
| `test-wechat-bot.sh`      | Send message to WeChat bot via osascript            |
| `test-lark-bot.sh`        | Send message to Lark / 飞书 bot via osascript       |
| `test-qq-bot.sh`          | Send message to QQ bot via osascript                |

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

Record automated demos using `record-app-screen.sh` (start/stop lifecycle, CDP screenshots + ffmpeg assembly). See [references/record-app-screen.md](references/record-app-screen.md) for full documentation.

```bash
./.agents/skills/local-testing/scripts/electron-dev.sh start
./.agents/skills/local-testing/scripts/record-app-screen.sh start my-demo
# ... run automation ...
./.agents/skills/local-testing/scripts/record-app-screen.sh stop
```

Outputs to `.records/` directory (gitignored): `<name>.mp4` (video) + `<name>/` (screenshots every 3s).

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

- **Always use `electron-dev.sh stop` to clean up** — `pkill -f "Electron"` only kills the main process; helper processes (GPU, renderer, network) survive. The script finds and kills all of them via PID matching against the project's electron binary path.
- **`npx electron-vite dev` must run from `apps/desktop/`** — running from project root fails silently. The `electron-dev.sh` script handles this automatically.
- **Don't resize the Electron window after load** — resizing triggers full SPA reload
- **Store is at `window.__LOBE_STORES`** not `window.__ZUSTAND_STORES__`

### osascript

See [reference/osascript-common.md](./reference/osascript-common.md#gotchas) for the full osascript gotchas list (accessibility permissions, `keystroke` non-ASCII issues, locale-specific app names, rate limiting, etc.).
