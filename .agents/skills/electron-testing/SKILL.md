---
name: electron-testing
description: Electron desktop app automation testing using agent-browser CLI. Use when testing UI features in the running Electron app, verifying visual state, interacting with the desktop app, or running manual QA scenarios. Triggers on 'test in electron', 'test desktop', 'electron test', 'manual test', or UI verification tasks.
---

# Electron Automation Testing with agent-browser

Use the `agent-browser` CLI to automate and test the LobeHub desktop Electron app.

## Prerequisites

- `agent-browser` CLI installed globally (`agent-browser --version`)
- Working directory must be `apps/desktop/` when starting Electron

## Quick Start

```bash
# 1. Kill existing instances
pkill -f "Electron" 2> /dev/null
pkill -f "electron-vite" 2> /dev/null
pkill -f "agent-browser" 2> /dev/null
sleep 3

# 2. Start Electron with CDP (MUST cd to apps/desktop first)
cd apps/desktop && ELECTRON_ENABLE_LOGGING=1 npx electron-vite dev -- --remote-debugging-port=9222 > /tmp/electron-dev.log 2>&1 &

# 3. Wait for startup (poll for "starting electron" in logs)
for i in $(seq 1 12); do
  sleep 5
  if strings /tmp/electron-dev.log 2> /dev/null | grep -q "starting electron"; then
    echo "ready"
    break
  fi
done

# 4. Wait for renderer to load, then connect
sleep 15 && agent-browser --cdp 9222 wait 3000
```

**Critical:** `npx electron-vite dev` MUST run from `apps/desktop/` directory, not project root. Running from root will fail silently (no `initUrl` in logs).

## Connecting to Electron

```bash
agent-browser --cdp 9222 snapshot -i    # Interactive elements only
agent-browser --cdp 9222 snapshot -i -C # Include contenteditable elements
```

Always use `--cdp 9222`. The `--auto-connect` flag is unreliable.

## Core Workflow

### 1. Snapshot → Find Elements

```bash
agent-browser --cdp 9222 snapshot -i
```

Returns element refs like `@e1`, `@e2`. **Refs are ephemeral** — re-snapshot after any page change (click, navigation, HMR).

### 2. Interact

```bash
agent-browser --cdp 9222 click @e5
agent-browser --cdp 9222 type @e3 "text" # Character by character (for contenteditable)
agent-browser --cdp 9222 fill @e3 "text" # Bulk fill (for regular inputs)
agent-browser --cdp 9222 press Enter
agent-browser --cdp 9222 scroll down 500
```

### 3. Wait

```bash
agent-browser --cdp 9222 wait 2000               # Wait ms
agent-browser --cdp 9222 wait --load networkidle # Wait for network
```

Avoid `agent-browser wait` for long durations (>30s) — it blocks the daemon. Use `sleep N` in bash instead, then take a new snapshot/screenshot.

### 4. Screenshot & Verify

```bash
agent-browser --cdp 9222 screenshot   # Save to ~/.agent-browser/tmp/screenshots/
agent-browser --cdp 9222 get text @e1 # Get element text
agent-browser --cdp 9222 get url      # Get current URL
```

Read screenshots with the `Read` tool for visual verification.

### 5. Evaluate JavaScript

```bash
agent-browser --cdp 9222 eval "document.title"
```

For multi-line JS, use `--stdin`:

```bash
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function() {
  var chat = window.__LOBE_STORES.chat();
  return JSON.stringify({
    totalOps: Object.keys(chat.operations).length,
    queue: chat.queuedMessages,
  });
})()
EVALEOF
```

## LobeHub-Specific Patterns

### Access Zustand Store State

The app exposes stores via `window.__LOBE_STORES` (dev mode only):

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

### Find the Chat Input

The chat input is a contenteditable div. Regular `snapshot -i` won't find it — use `-C`:

```bash
agent-browser --cdp 9222 snapshot -i -C 2>&1 | grep "editable"
# Output: - generic [ref=e48] editable [contenteditable]:
```

### Navigate to an Agent

```bash
# Snapshot to find agent links in sidebar
agent-browser --cdp 9222 snapshot -i 2>&1 | grep -i "agent-name"
# Click the agent link
agent-browser --cdp 9222 click @e<ref>
agent-browser --cdp 9222 wait 2000
```

### Send a Chat Message

```bash
# 1. Find contenteditable input
agent-browser --cdp 9222 snapshot -i -C 2>&1 | grep "editable"
# 2. Click, type, send
agent-browser --cdp 9222 click @e<ref>
agent-browser --cdp 9222 type @e<ref> "Hello world"
agent-browser --cdp 9222 press Enter
```

### Wait for Agent to Complete

Don't use `agent-browser wait` for long AI generation. Use `sleep` + screenshot:

```bash
sleep 60 && agent-browser --cdp 9222 scroll down 5000 && agent-browser --cdp 9222 screenshot
```

Or poll the store for operation status:

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

### Install Error Interceptor

Capture `console.error` from the app for debugging:

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

## Screen Recording

Record automated demos by combining `ffmpeg` screen capture with `agent-browser` automation. The script `.agents/skills/electron-testing/record-electron-demo.sh` handles the full lifecycle.

### Usage

```bash
# Run the built-in demo (queue-edit feature)
./.agents/skills/electron-testing/record-electron-demo.sh

# Run a custom automation script
./.agents/skills/electron-testing/record-electron-demo.sh ./my-demo.sh /tmp/my-demo.mp4
```

The script automatically:

1. Starts Electron with CDP and waits for SPA to load
2. Detects the window position, screen, and Retina scale via Swift/CGWindowList
3. Records only the Electron window region using `ffmpeg -f avfoundation` with crop
4. Runs the demo (built-in or custom script receiving CDP port as `$1`)
5. Stops recording and cleans up

### Writing Custom Demo Scripts

Create a shell script that receives the CDP port as `$1`:

```bash
#!/usr/bin/env bash
# my-demo.sh — Custom demo script
PORT=$1

# Navigate
agent-browser --cdp "$PORT" snapshot -i 2>&1 | grep 'link "Lobe AI"'
agent-browser --cdp "$PORT" click @e34
sleep 3

# Find input and type
INPUT=$(agent-browser --cdp "$PORT" snapshot -i -C 2>&1 \
  | grep "editable" | grep -oE 'ref=e[0-9]+' | head -1 | sed 's/ref=//')
agent-browser --cdp "$PORT" click "@$INPUT"
agent-browser --cdp "$PORT" type "@$INPUT" "Hello world"
agent-browser --cdp "$PORT" press Enter
sleep 5
```

### Key Details

- **Multi-monitor support**: Uses Swift to find which screen the Electron window is on and calculates relative crop coordinates
- **Retina aware**: Scales crop coordinates by the display's `backingScaleFactor`
- **No window resize**: Records the window at its current position/size to avoid triggering SPA reload
- **SPA load polling**: Waits for interactive elements to appear before starting the demo
- **Prerequisites**: `ffmpeg` (`brew install ffmpeg`), `agent-browser`

## Gotchas

- **`npx electron-vite dev` must run from `apps/desktop/`** — running from project root fails silently
- **HMR invalidates everything** — after code changes, refs break, page may crash. Re-snapshot or restart Electron
- **`agent-browser wait` blocks the daemon** — for waits >30s, use bash `sleep` instead
- **Daemon can get stuck** — if commands hang, `pkill -f agent-browser` to reset the daemon
- **`snapshot -i` doesn't find contenteditable** — always use `snapshot -i -C` to find rich text editors
- **`fill` doesn't work on contenteditable** — use `type` for the chat input
- **Screenshots go to `~/.agent-browser/tmp/screenshots/`** — read them with the `Read` tool
- **Store is at `window.__LOBE_STORES`** not `window.__ZUSTAND_STORES__` — use `.chat()` to get current state
- **Don't resize the Electron window after load** — resizing triggers a full SPA reload (splash screen), which can take 30+ seconds or get stuck. Record at the window's current size instead
- **`screencapture -V -l<windowid>`** doesn't work reliably for video — use `ffmpeg -f avfoundation` with crop instead (see Screen Recording section)
