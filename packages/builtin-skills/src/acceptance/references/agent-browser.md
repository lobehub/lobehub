# agent-browser CLI reference

Generic reference for the `agent-browser` CLI — automate Chromium-based apps
(Electron, Chrome, web) via Chrome DevTools Protocol. This is the capture engine
for all UI evidence in this skill. Per - 端 patterns live in
[../surfaces/web.md](../surfaces/web.md) and
[../surfaces/electron.md](../surfaces/electron.md); auth recipes in
[auth.md](./auth.md).

Install via `npm i -g agent-browser`, `brew install agent-browser`, or
`cargo install agent-browser`. Run `agent-browser install` to download Chrome.
Run `agent-browser upgrade` to update.

## Core workflow

Every browser automation follows this pattern:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (get element refs like `@e1`, `@e2`)
3. **Interact**: use refs to click, fill, select
4. **Re-snapshot**: after navigation or DOM changes, get fresh refs

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output: @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i # check result
```

## Command chaining

```bash
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
```

Use `&&` when you don't need to read intermediate output. Run commands separately
when you need to parse output first (e.g. snapshot to discover refs, then interact).

## Essential commands

```bash
# Navigation
agent-browser open <url>              # Navigate (aliases: goto, navigate)
agent-browser close                   # Close browser
agent-browser close --all             # Close all active sessions

# Snapshot
agent-browser snapshot -i             # Interactive elements with refs (recommended)
agent-browser snapshot -i -C          # Include contenteditable (rich text editors)
agent-browser snapshot -s "#selector" # Scope to CSS selector

# Interaction (use @refs from snapshot)
agent-browser click @e1               # Click element
agent-browser click @e1 --new-tab     # Click and open in new tab
agent-browser fill @e2 "text"         # Clear and type text (NOT for contenteditable)
agent-browser type @e2 "text"         # Type without clearing (use for chat inputs)
agent-browser select @e1 "option"     # Select dropdown option
agent-browser check @e1               # Check checkbox
agent-browser press Enter             # Press key
agent-browser keyboard type "text"    # Type at current focus (no selector)
agent-browser scroll down 500         # Scroll page
agent-browser scroll down 500 --selector "div.content"  # Scroll within container

# Get information
agent-browser get text @e1            # Get element text
agent-browser get url                 # Get current URL
agent-browser get title               # Get page title

# Wait
agent-browser wait @e1                # Wait for element
agent-browser wait --load networkidle # Wait for network idle
agent-browser wait --url "**/page"    # Wait for URL pattern
agent-browser wait 2000               # Wait milliseconds
agent-browser wait --text "Welcome"   # Wait for text to appear
agent-browser wait --fn "!document.body.innerText.includes('Loading...')"  # Wait for condition
agent-browser wait "#spinner" --state hidden  # Wait for element to disappear

# Network (key for full-stack evidence)
agent-browser network requests                 # Inspect tracked requests
agent-browser network requests --type xhr,fetch  # Filter by resource type
agent-browser network requests --method POST   # Filter by HTTP method
agent-browser network har start                # Start HAR recording
agent-browser network har stop ./capture.har   # Stop and save HAR file

# Viewport & device emulation
agent-browser set viewport 1920 1080          # Set viewport size (default 1280x720)
agent-browser set viewport 1920 1080 2        # 2x retina
agent-browser set device "iPhone 14"          # Emulate device (viewport + UA)

# Capture (evidence!)
agent-browser screenshot ./shot.png   # Screenshot to a path
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf          # Save as PDF

# Dialogs (alert, confirm, prompt, beforeunload)
agent-browser dialog accept           # Accept dialog
agent-browser dialog accept "input"   # Accept prompt dialog with text
agent-browser dialog dismiss          # Dismiss/cancel dialog
agent-browser dialog status           # Check if dialog is open
```

## Batch execution

```bash
echo '[
  ["open", "https://example.com"],
  ["snapshot", "-i"],
  ["click", "@e1"],
  ["screenshot", "result.png"]
]' | agent-browser batch --json
```

## Semantic locators (alternative to refs)

```bash
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find role button click --name "Submit"
agent-browser find placeholder "Search" type "query"
agent-browser find testid "submit-btn" click
```

## JavaScript evaluation (eval)

Use eval to read app state, dump DOM/HTML, or assert computed values for `text` /
`dom_snapshot` evidence.

```bash
# Simple expressions
agent-browser eval 'document.title'

# Complex JS: use --stdin with heredoc (RECOMMENDED — avoids shell quoting bugs)
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

> If the app under test exposes a global state object (a store, a debug handle),
> eval is how you read it for assertion. Don't assume a specific global name —
> discover it from the app you are verifying.

## Ref lifecycle

Refs (`@e1`, `@e2`, …) are invalidated when the page changes. Always re-snapshot
after clicking links/buttons that navigate, form submissions, or dynamic content
loading. After a hot-reload (HMR) during dev, refs also break — re-snapshot.

## Annotated screenshots (vision mode)

```bash
agent-browser screenshot --annotate
# Output includes the image path and a legend:
#   [1] @e1 button "Submit"
#   [2] @e2 link "Home"
agent-browser click @e2 # click using ref from annotated screenshot
```

## Parallel sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com
agent-browser session list
```

A named `--session` auto-saves and restores cookies + localStorage, which is the
basis for the auth recipes in [auth.md](./auth.md).

## Connect to an existing browser / app

```bash
agent-browser --auto-connect snapshot # Auto-discover a running Chrome
agent-browser --cdp 9222 snapshot     # Explicit CDP port (Electron apps, see ../surfaces/electron.md)
```

## Cloud providers & engine selection

```bash
agent-browser -p browserbase open example.com      # run against a cloud browser
agent-browser --engine lightpanda open example.com # 10x faster, 10x less memory
```

Providers: `agentcore`, `browserbase`, `browserless`, `browseruse`, `kernel`.

## Gotchas

- **Daemon can get stuck** — if commands hang, `agent-browser close --all` or
  `pkill -f agent-browser` to reset.
- **HMR invalidates everything** — after code changes during dev, refs break;
  re-snapshot or restart.
- **`snapshot -i` doesn't find contenteditable** — use `snapshot -i -C` for rich
  text editors; `fill` doesn't work on contenteditable, use `type`.
- **Screenshots written to a path are easiest** — `agent-browser screenshot
./proof/x.png` then upload that path; with no path they land in
  `~/.agent-browser/tmp/screenshots/`.
- **Dialogs block all commands** — if commands time out, check
  `agent-browser dialog status`.
- **Default timeout is 25s** — override with `AGENT_BROWSER_DEFAULT_TIMEOUT` (ms)
  or use explicit waits.
- **Shell quoting corrupts eval** — use `eval --stdin <<'EVALEOF'` for complex JS.
