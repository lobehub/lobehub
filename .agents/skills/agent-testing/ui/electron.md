# Electron (LobeHub Desktop) UI Testing

Default surface for verifying **pure frontend changes** (components, store logic, styles, interactions) in the primary product shape. Drives the Electron renderer over CDP with `agent-browser` — see [../references/agent-browser.md](../references/agent-browser.md) for the full command reference.

**Auth**: the Electron app keeps its own persistent login state — log in once manually in the app; sessions survive restarts. Run `../scripts/setup-auth.sh status` before testing (see [../references/auth.md](../references/auth.md)).

**Linux / headless (cloud)**: Electron itself runs on Linux, but it has no true headless mode — it needs a display server. In a headless environment wrap the launch with `xvfb-run` (virtual framebuffer). Everything CDP-based keeps working under Xvfb: the `agent-browser --cdp 9222` connection, snapshots, eval, and `agent-browser screenshot` (captured from the renderer via CDP, not the OS screen). What does NOT work on Linux: `capture-app-window.sh` (macOS `screencapture`), osascript, and the ffmpeg recording scripts in their current form.

### Setup / Teardown

Use the `electron-dev.sh` script to manage the Electron dev environment. It handles process lifecycle, waits for SPA readiness, and reliably kills all child processes (main + helpers + vite).

```bash
SCRIPT=".agents/skills/agent-testing/scripts/electron-dev.sh"

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

## Electron Gotchas

- **Always use `electron-dev.sh stop` to clean up** — `pkill -f "Electron"` only kills the main process; helper processes (GPU, renderer, network) survive. The script finds and kills all of them via PID matching against the project's electron binary path.
- **`npx electron-vite dev` must run from `apps/desktop/`** — running from project root fails silently. The `electron-dev.sh` script handles this automatically.
- **Don't resize the Electron window after load** — resizing triggers full SPA reload
- **Store is at `window.__LOBE_STORES`** not `window.__ZUSTAND_STORES__`
