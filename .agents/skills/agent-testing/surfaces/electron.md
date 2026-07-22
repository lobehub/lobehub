# Electron (Desktop) UI Testing

Default surface for verifying **pure frontend changes** (components, store logic,
styles, interactions) in a project that ships an Electron desktop shell. Drives the
Electron renderer over CDP with `agent-browser` — see
[../references/agent-browser.md](../references/agent-browser.md) for the full
command reference.

The launch/stop of the desktop dev instance, its CDP port, its login persistence,
and any state probes all come from
[`.agents/acceptance/PROJECT.md`](../references/project-adapter.md) §4/§5. This guide is
the CDP methodology; the project supplies the commands.

## Auth

Sign in once, not once per run — the project's desktop dev tooling should persist
login across runs (`PROJECT.md` §3 says how). If an instance still comes up signed
out, **inject the login state directly** (restore the persisted snapshot, or mint
it via CLI/API seeding per `PROJECT.md` §3); **never trigger an interactive
login/OAuth flow** — it opens a login page in the user's own browser. When no
injectable state exists, report auth as blocked and ask for one manual sign-in.
Run the desktop auth status check from `PROJECT.md` §3 before testing.

## Linux / headless (cloud)

Electron runs on Linux but has no true headless mode — it needs a display server.
In a headless environment wrap the launch with `xvfb-run` (virtual framebuffer).
Everything CDP-based keeps working under Xvfb: the `agent-browser --cdp <port>`
connection, snapshots, eval, and `agent-browser screenshot` (captured from the
renderer via CDP, not the OS screen). What does NOT work on Linux:
`capture-app-window.sh` (macOS `screencapture`), osascript, and OS-level recording.

## Setup / Teardown

Start and stop the desktop dev instance with the project's own script (per
`PROJECT.md` §4) — it should handle process lifecycle and reliably kill all child
processes (main + helpers + bundler). After start succeeds, connect with:

```bash
PORT=9222 # the CDP port from PROJECT.md
agent-browser --cdp "$PORT" snapshot -i
```

**Always run the project's stop command when done** — a bare `pkill -f "Electron"`
does not catch all helper processes (GPU, renderer, network), which survive and
corrupt the next run.

## Project probes & quick navigation

A project may ship a **state probe** — a fast path into app state (auth check,
current route, running operations, and a `goto <path>` quick-navigation that jumps
straight to the state under test instead of clicking through the UI). If it does,
`PROJECT.md` §5 documents it; use it instead of hand-rolling store-introspection
eval snippets. When the project has no probe, fall back to raw `agent-browser eval`
against the renderer, reading whatever store/global the app exposes for debugging.

For one-off state inspection, `agent-browser eval` against the CDP target is always
available:

```bash
agent-browser --cdp "$PORT" eval --stdin << 'EVALEOF'
(function() { /* read app state here */ })()
EVALEOF
```

## Method notes (project-independent)

- **A running desktop instance may serve a STALE built bundle, not your working
  tree.** A resident/packaged app serves a built renderer snapshot; it does not
  reflect uncommitted or HMR src changes. Verify working-tree UI in an isolated dev
  instance that loads live code, and **prove it is live by measuring a
  known-changed value** (a computed style, a new string) before trusting any
  screenshot. Don't disturb the user's resident instance — use a separate dev
  instance/port.
- **Main-process code changes need a restart; renderer HMR does not cover them.**
  If the change lives in the main process (or a package that runs there), reloading
  the renderer verifies nothing — the old main-process code is still running. Prove
  which code each process has (curl the dev bundler for the renderer source and
  grep for a marker; grep the built main bundle for the marker) before trusting a
  run.
- **Distinguish a non-painting renderer from an empty DOM.** `innerText` needs
  layout, `textContent` does not. If a probe reads `innerText.length === 0` while
  `textContent` still holds the full DOM, the DOM is fine and the renderer is not
  compositing — often after a mid-session bundler dependency re-optimize; a restart
  of the instance clears it, a `location.reload()` alone may not.

## Electron Gotchas

- **`agent-browser screenshot` can wedge the daemon; prefer raw-CDP capture.**
  agent-browser routes captures through a long-lived daemon. An interrupted or
  mis-invoked screenshot can leave the daemon's CDP session half-open, after which
  **every** later screenshot fails (`CDP response channel closed` / `daemon busy`)
  even though `eval` / `get url` still work. This is **not** a display-sleep or
  permission problem: raw `Page.captureScreenshot` is fast and works even when the
  display is asleep or the window is minimized/occluded. Use the raw-CDP helper for
  Electron evidence and as a preflight:

  ```bash
  "$SKILL_DIR/scripts/cdp-screenshot.sh" --check               # preflight: PASS ⇒ capture works
  "$SKILL_DIR/scripts/cdp-screenshot.sh" --out shot.png        # viewport
  "$SKILL_DIR/scripts/cdp-screenshot.sh" --out full.png --full # full page (captureBeyondViewport)
  ```

  If agent-browser's own screenshot has already wedged, reset it with
  `agent-browser close --all` (raw-CDP does not use that daemon and is unaffected).

- **Dev builds may auto-open DevTools, which hijacks the CDP target** —
  `agent-browser --cdp <port>` may attach to the DevTools page (`devtools://…`)
  instead of the app. Symptom: `get url` returns a `devtools://` URL. Fix: close the
  DevTools target and reconnect:

  ```bash
  DT_ID=$(curl -s "http://localhost:$PORT/json/list" | python3 -c "import json,sys; ts=json.load(sys.stdin); print(next(t['id'] for t in ts if t['type']=='page' and t['url'].startswith('devtools://')))")
  curl -s "http://localhost:$PORT/json/close/$DT_ID" > /dev/null
  agent-browser close --all && agent-browser --cdp "$PORT" get url # expect the app URL
  ```

- **Don't resize the Electron window after load** — resizing can trigger a full SPA
  reload and lose your state.

- **Streaming / ticking UI needs GIF evidence** — see `scripts/record-gif.sh`; a
  static screenshot cannot prove time-based behavior.
