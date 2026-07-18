# agent-browser CLI Reference

Generic reference for the `agent-browser` CLI — automate Chromium-based apps
(Electron, Chrome, web) via Chrome DevTools Protocol. Surface-specific patterns
live in [../surfaces/web.md](../surfaces/web.md) and
[../surfaces/electron.md](../surfaces/electron.md); project auth recipes live in
`.agents/verify/PROJECT.md`.

Install via `npm i -g agent-browser`, `brew install agent-browser`, or
`cargo install agent-browser`. Run `agent-browser install` to download Chrome. Run
`agent-browser upgrade` to update.

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

## GOMS-KLM interaction tracing

When a UI verification should report user-side interaction cost, run
`agent-browser` through the agent-testing wrapper:

```bash
TRACE="$DIR/interaction-trace.jsonl"
SESSION=your-session # from PROJECT.md; $SKILL_DIR = the skill's install dir

"$SKILL_DIR/scripts/agent-browser-klm.mjs" \
  --klm-trace "$TRACE" --klm-phase settings --klm-check case-1 \
  --session "$SESSION" click @e4
```

The wrapper forwards the real command to `agent-browser` and appends one JSONL
event. Physical actions are inferred from the command (`click → P+K`,
`fill/type → P+T(n)`, `press → K`, `wait → R`). A click only counts the user
activation; if it causes loading or async work, follow it with an explicit
`agent-browser wait ...` so response time is counted as `R`.

Mental effort is intentionally not guessed from DOM shape. After the first
meaningful page view, add an explicit agent estimate:

```bash
"$SKILL_DIR/scripts/agent-browser-klm.mjs" mental \
  --klm-trace "$TRACE" --klm-phase first-view --m 2 --score 3 \
  --confidence 0.75 --reason "Need to understand current page state and choose the verify path"
```

Before publish, summarize the trace into the structured report:

```bash
"$SKILL_DIR/scripts/agent-browser-klm-analyze.mjs" \
  --trace "$TRACE" --result "$DIR/result.json" --write
```

This populates `result.json.interactionCost` with the `goms-klm@lobe-v1` summary.
The raw trace stays in the local report directory for audit/debug.

## Command Chaining

```bash
# Chain open + wait + snapshot in one call
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
```

Use `&&` when you don't need to read intermediate output. Run commands separately
when you need to parse output first (e.g. snapshot to discover refs, then interact).

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
agent-browser set offline on|off              # Toggle offline (under `set`, not a top-level cmd)

# Capture
agent-browser screenshot              # Screenshot to temp dir
agent-browser screenshot --full       # Full page screenshot
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf          # Save as PDF

# Diff (compare page states)
agent-browser diff snapshot                          # Compare current vs last snapshot
agent-browser diff screenshot --baseline before.png  # Visual pixel diff
agent-browser diff url <url1> <url2>                 # Compare two pages
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

For a local dev server where a headed login is awkward, copy the session cookie out
of a **Network request** in your own browser's DevTools and load it via
`state load`. The exact cookie name and origin for the project under test come from
`PROJECT.md` §3.

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

Refs (`@e1`, `@e2`, etc.) are invalidated when the page changes. Always re-snapshot
after clicking links/buttons that navigate, form submissions, or dynamic content
loading.

## Parallel Sessions

```bash
agent-browser --session site1 open https://site-a.com
agent-browser --session site2 open https://site-b.com
agent-browser session list
```

Each session is a separate daemon socket, so a wedge in one session is scoped to
that session, not the whole tool. Use distinct session names per target when driving
more than one page.

## Connect to Existing Chrome / Electron

```bash
agent-browser --auto-connect snapshot # Auto-discover running Chrome
agent-browser --cdp 9222 snapshot     # Explicit CDP port (Electron dev, remote-debugging Chrome)
```

## Gotchas

- **Daemon can get stuck** — if commands hang, `agent-browser close --all` or
  `pkill -f agent-browser` to reset. A screenshot RPC that is interrupted can leave
  the session's socket half-consumed, after which every later `screenshot` fails
  (`CDP response channel closed` / `Resource temporarily unavailable`) while
  `eval` / `get url` keep working — reset with `close --all`, or bypass the daemon
  with `scripts/cdp-screenshot.sh` (raw CDP).
- **HMR invalidates everything** — after code changes, refs break. Re-snapshot or
  restart.
- **`snapshot -i` doesn't find contenteditable** — use `snapshot -i -C` for rich
  text editors.
- **`fill` doesn't work on contenteditable** — use `type` for rich-text inputs.
- **Screenshots go to `~/.agent-browser/tmp/screenshots/`** unless you pass a path —
  a relative path saves to the caller's cwd; pass an absolute path in longer scripts
  so a lost cwd doesn't misplace the file. Read them with the `Read` tool.
- **`network requests` under-reports** — it is not ground truth for "did the request
  happen". To judge whether a fault landed, wrap `window.fetch` and record each
  request's own outcome (see probe-mock-patterns).
- **`set offline` trips Chrome's own offline interstitial**, not the app's error
  state — its "Reconnect" copy also false-matches error-copy greps. Use it to break
  connectivity, not to assert an app-level error.
- **`wait --load networkidle` HANGS during a retry loop** (the network never idles)
  and can blow the command timeout — use a fixed `wait <ms>` when a fetch is stuck
  retrying. (macOS has no `timeout(1)` to bound it.)
- **Dialogs block all commands** — if commands time out, check
  `agent-browser dialog status`.
- **Default timeout is 25s** — override with `AGENT_BROWSER_DEFAULT_TIMEOUT` (ms) or
  use explicit waits.
- **Shell quoting corrupts eval** — use `eval --stdin <<'EVALEOF'` for complex JS.
- **A blank page at `about:blank` with a 1280px viewport usually means the previous
  `open` failed** (exited non-zero without navigating). The session still answers
  every later probe — against the fresh page it was born with. Read the `open` exit
  code and stderr rather than assuming the page went blank.
