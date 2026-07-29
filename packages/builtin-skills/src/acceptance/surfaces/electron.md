# Desktop (Electron) surface

Use this surface for **desktop-only behavior** — native windows, IPC / main-process
code, tray/menu, auto-update, OS integration, or a packaged-only path. That code
doesn't exist in a plain web page, so [web.md](./web.md) can't prove it. You drive
the running app's renderer over CDP with `agent-browser`
([../references/agent-browser.md](../references/agent-browser.md)).

For a change that behaves identically in a browser, prefer [web.md](./web.md) —
it's lighter and cloud-portable. Use Electron only when the criterion calls out
the desktop shell.

## Setup

1. Start the desktop app in dev/debug mode with a CDP port open (commonly 9222).
   How you start it is app-specific (its own dev command); the requirement is a
   reachable CDP endpoint.
2. Connect agent-browser to that port:

```bash
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 get url # sanity-check you attached to the app
agent-browser --cdp 9222 screenshot ./proof/desktop-state.png
```

3. Auth: a desktop app usually keeps its own persistent login state in its
   user-data dir — log in once in the app and it survives restarts; no injection
   needed (see [../references/auth.md](../references/auth.md#desktop)).

## Reading app state

If the app exposes a global state handle, eval it to assert behavior (discover the
actual global name from the app — don't assume one):

```bash
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function () {
  // example shape — replace with the app's real global / selectors
  var s = window.__APP_STATE__ && window.__APP_STATE__();
  return JSON.stringify({ route: location.hash || location.pathname, ready: !!s });
})()
EVALEOF
```

## Capturing console errors during a run

```bash
# install an interceptor before exercising the feature
agent-browser --cdp 9222 eval --stdin << 'EVALEOF'
(function () {
  window.__ERRORS__ = [];
  var orig = console.error;
  console.error = function () {
    window.__ERRORS__.push(Array.from(arguments).map(String).join(' '));
    orig.apply(console, arguments);
  };
  return 'installed';
})()
EVALEOF
# ... drive the feature ...
agent-browser --cdp 9222 eval "JSON.stringify(window.__ERRORS__)" # → text evidence
```

## Gotchas

- **Dev builds often auto-open DevTools, which hijacks the CDP target.** Symptom:
  `get url` returns a `devtools://…` URL instead of the app. Fix: close the
  DevTools target and reconnect:

  ```bash
  DT_ID=$(curl -s http://localhost:9222/json/list | python3 -c "import json,sys; ts=json.load(sys.stdin); print(next(t['id'] for t in ts if t['type']=='page' and t['url'].startswith('devtools://')))")
  curl -s "http://localhost:9222/json/close/$DT_ID" > /dev/null
  agent-browser close --all && agent-browser --cdp 9222 get url
  ```

- **Clean up all processes when done.** `pkill -f "Electron"` only kills the main
  process; helper processes (GPU, renderer, network) survive. Prefer the app's own
  stop command or kill by the project's electron binary path.

- **Don't resize the window after load** — many apps trigger a full reload on
  resize, invalidating refs and state.

## Time-based behavior & OS-level steps

- **Behavior over time** needs a clip — record CDP frames into MP4/GIF:
  [../references/recording.md](../references/recording.md).
- **Native chrome around the app** (file pickers, system dialogs, menu-bar/dock,
  permission prompts) lives outside the renderer — drive it with Computer Use:
  [../references/computer-use.md](../references/computer-use.md).

## Boundaries — headless / cloud

Electron runs on Linux but has no true headless mode — it needs a display server.
In a headless/cloud environment, wrap the launch with `xvfb-run` (virtual
framebuffer). Everything CDP-based keeps working under Xvfb (connection, snapshots,
eval, `agent-browser screenshot` — captured from the renderer, not the OS screen).
What does NOT work: OS-window capture (`screencapture`), osascript, and native
screen recording — all macOS-only. Keep evidence CDP-based to stay cloud-portable
(see [../references/evidence.md](../references/evidence.md#headless--cloud-portability)).
