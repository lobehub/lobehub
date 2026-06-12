# agent-browser CLI Reference

Generic reference for the `agent-browser` CLI — automate Chromium-based apps (Electron, Chrome, web) via Chrome DevTools Protocol. LobeHub-specific patterns live in [../ui/electron.md](../ui/electron.md) and [../ui/web.md](../ui/web.md); authentication recipes live in [auth.md](./auth.md).

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

### LobeHub dev server — inject better-auth cookie

`agent-browser --headed` on macOS can create an off-screen Chromium window, blocking manual login. For a local LobeHub dev server (e.g. `localhost:3010`), copy the `better-auth.session_token` cookie out of a **Network request** in the user's own Chrome DevTools and load it via `state load`. See [auth.md](./auth.md) for the full recipe.

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

## Gotchas

- **Daemon can get stuck** — if commands hang, `agent-browser close --all` or `pkill -f agent-browser` to reset
- **HMR invalidates everything** — after code changes, refs break. Re-snapshot or restart
- **`snapshot -i` doesn't find contenteditable** — use `snapshot -i -C` for rich text editors
- **`fill` doesn't work on contenteditable** — use `type` for chat inputs
- **Screenshots go to `~/.agent-browser/tmp/screenshots/`** — read them with the `Read` tool
- **Dialogs block all commands** — if commands time out, check `agent-browser dialog status`
- **Default timeout is 25s** — override with `AGENT_BROWSER_DEFAULT_TIMEOUT` (ms) or use explicit waits
- **Shell quoting corrupts eval** — use `eval --stdin <<'EVALEOF'` for complex JS
