# Probe / Mock Pattern Library

> **Purpose**: the accumulated, verified recipes for probing app/runtime state
> and mocking / faulting network in agent-testing. Every time a probe or a mock
> is **blocked, bypassed, or needs a workaround** during a run, add an item here
> recording what does NOT work and what DOES.
> **Read this before any run that needs to force an error state or inspect
> runtime state.** Each item: Situation / Doesn't work / Works.

---

## A. Forcing a fetch to FAIL (error-state testing)

### A1. `network route --abort` does not intercept this app's TRPC

- **Doesn't work**: `agent-browser network route "**/trpc/**" --abort` blocks
  nothing — 815 requests still returned 200. The interception simply doesn't
  apply to the SPA's batched TRPC fetches.

### A2. Post-load `window.fetch` override is bypassed

- **Doesn't work**: `eval`-ing a `window.fetch` override after page load. The
  TRPC client captures the `fetch` reference at client-creation (page load), so
  it never sees a later override. (Would need `addScriptToEvaluateOnNewDocument`,
  which agent-browser doesn't expose.)

### A3. `set offline` shows Chrome's page, not the component error

- **Doesn't work for component errors**: `agent-browser set offline on` trips
  Chrome's document-level offline interstitial ("Reconnect to Wi-Fi"), not the
  app's `AsyncError`. Its "Reload" button also false-matches error-copy greps.
  (Offline also breaks lazy route-chunk loading → hard-nav fallback → Chrome page.)

### A4. ✅ WORKS — client-service fetcher instrumentation via HMR

- Add a throw at the top of the client service method the SWR fetcher calls,
  then let Vite HMR apply it, screenshot, and `git checkout --` to revert:
  ```ts
  // src/services/task.ts (the method useFetchTaskList's fetcher calls)
  list = async (params) => {
    // [AGENT-TEST] REMOVE
    if (true) throw Object.assign(new Error('injected'), { data: { httpStatus: 500 } });
    return lambdaClient.task.list.query(params);
  };
  ```
- `data.httpStatus: 500` → the error is retryable, so `AsyncError` shows the
  Retry button AND the status-specific copy (`response.500`). Use a status the
  UI treats as retryable if you want the Retry button visible.
- Revert with `git checkout -- <service files>`; grep `AGENT-TEST` to confirm no
  residue.

### A5. ✅ ALTERNATIVES (valid, use if HMR isn't available)

- CDP `Network.setBlockedURLs` — blocks at the network stack (below fetch, so it
  DOES catch TRPC). Needs a raw CDP ws (see C2 for getting the endpoint).
- Server-side: temporarily make the one endpoint return 500.

### A6. ✅ WORKS — WRITE-side (mutation) fault injection, same HMR technique

- To test the write-side save-state UI (`AutoSaveHint` failed tag + `saveToast`),
  inject the throw into the client service **mutation** method, not a fetcher:
  ```ts
  // src/services/task.ts — the method the store action calls (updateTask → taskService.update)
  update = async (id, data) => {
    // [AGENT-TEST] REMOVE
    if (true)
      throw Object.assign(new Error('injected save failure'), { data: { httpStatus: 500 } });
    return lambdaClient.task.update.mutate({ id, ...data });
  };
  ```
  Then trigger a save in the UI (edit the title / change the model). `runMutation`
  sets `taskSaveStatus:'failed'` and calls `saveToast`. `httpStatus:500` ⇒ retryable
  ⇒ the toast shows a Retry action; 401/403 would suppress it.
- **Gotcha — reverting the injection triggers a FULL page reload.** `git checkout --`
  on a service file makes Vite do a full reload (not just HMR), so the SPA resets to
  a blank Main Layout (Case 1 trap: a blank shell with only the `Debug ID` tag).
  After reverting, **re-navigate** (`agent-browser open .../task/<id>`) and re-fetch
  element refs before continuing the recovery test.

---

## B. Cache / stale state that MASKS the failure

### B1. SWR persisted cache treats a failed revalidation as "keep settled content"

- **Situation**: a surface loaded successfully once caches the last-good value
  (e.g. `[]`). On a later failed fetch, `AsyncBoundary` correctly keeps the
  settled content and does NOT show the error (by design: background error must
  not blow away loaded content). So your injected failure shows the old content,
  not the error.
- **Works**: to see a genuine FIRST-LOAD error, clear all client storage, then
  cold-load. Clearing logs you out → re-seed auth after.
  ```js
  // agent-browser eval --stdin
  (async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    try {
      const d = await indexedDB.databases();
      await Promise.all(
        (d || []).map(
          (x) =>
            new Promise((r) => {
              const q = indexedDB.deleteDatabase(x.name);
              q.onsuccess = q.onerror = q.onblocked = () => r();
            }),
        ),
      );
    } catch {}
    try {
      const k = await caches.keys();
      await Promise.all(k.map((c) => caches.delete(c)));
    } catch {}
    return 1;
  })();
  ```
  then `setup-auth.sh web-seed`, then `open about:blank` → `open <target>`.

### B2. SWR retries 5× (\~31s) before the error settles

- **Situation**: `useClientDataSWR` retries failed fetches with exponential
  backoff, max 5 (\~31s). During retries `isLoading` is true → you screenshot a
  skeleton, not the error.
- **Works**: wait \~35s after load for retries to exhaust, THEN screenshot. (Or
  inject `meta.shouldRetry=false` to skip retries — but that also hides the Retry
  button via `normalizeAsyncError`.)

### B3. In-memory SWR cache survives `open`; persisted cache survives everything

- `open about:blank` then `open <target>` forces a fresh JS context (clears
  in-memory SWR) but does NOT clear persisted storage — you still need B1 for a
  true cold load.

---

## C. Probing app / store runtime state

### C1. `window.__LOBE_STORES.<name>` has no `.getState`

- **Doesn't work**: `window.__LOBE_STORES.page.getState()` — the value is a bound
  hook function exposing only `length`/`name`; state isn't readable from it.

### C2. ✅ WORKS — temporary debug global inside the component

- The decisive way to read a component's live props / store / SWR values: add a
  debug global in the render, reload, read it, remove it.
  ```tsx
  // inside the component render, temporary:
  if (typeof window !== 'undefined')
    (window as any).__DBG = {
      data: data === undefined ? 'undefined' : `array[${(data as any).length}]`,
      hasError: !!error,
      isLoading,
    };
  ```
  ```bash
  agent-browser --session $S eval 'JSON.stringify(window.__DBG)'
  ```
  This is exactly what surfaced the Pages `documents=[]` bug (data looked settled
  even on error).

### C3. Console capture is unreliable here

- `agent-browser console` and `app-probe.sh errors` returned nothing this run.
  Prefer the debug-global (C2) over console reading.

### C4. `document.body.innerText` keyword grep false-positives on fixture text

- **Situation**: asserting a state like "保存失败" / "Save failed" via
  `body.innerText.includes('保存失败')`. If the test fixture's own content contains
  that substring (e.g. a task literally named " 验证保存**失败**态的测试任务 "), the grep
  matches the fixture, not the state indicator — a false PASS on the error state
  even when it never rendered (a Case-1 grep trap).
- **Works**: scope the check to the actual UI element, never `body.innerText`:
  - the save hint tag → `[...document.querySelectorAll('[class*=Tag],.ant-tag')].map(t=>t.textContent.trim())`
  - the toast → find the leaf node matching the message, climb while the subtree
    text stays short, then read its `button`s (`[Close, 重试]`).
    Pick fixture names that do NOT contain any state keyword you'll assert on.

---

## D. agent-browser / CDP mechanics

- **D1. `screenshot` needs an ABSOLUTE path.** A relative path is silently
  ignored and it saves to `~/.agent-browser/tmp/screenshots/`. Always pass an
  absolute path (e.g. `"$DIR/assets/x.png"` where `$DIR` is absolute).
- **D2. CDP port is ephemeral.** `agent-browser cdp-url` returned empty and the
  browser runs with `--remote-debugging-port=0`. For raw CDP, read
  `DevToolsActivePort` in the browser user-data-dir.
- **D3. offline is `agent-browser set offline on|off`** (under `set`, with
  `viewport`/`geo`/`headers`), not a top-level `offline` command.
- **D4. `wait --load networkidle` HANGS during a retry loop** (network never
  idles) and can blow the command timeout — use a fixed `wait <ms>` instead when
  a fetch is stuck retrying.
- **D5. base-ui `toast` lives in a portal, auto-dismisses in \~5s, and can be
  occluded by the dev FPS overlay.** `snapshot -i` does NOT reliably surface the
  portal's action buttons (the `重试`/Retry ref came back empty); read the toast
  via `eval` DOM query instead. The bottom-right dev FPS/debug widget overlaps the
  bottom-right toast, hiding the action row in screenshots — relocate the toast
  region for a clean shot:
  ```js
  [...document.querySelectorAll('[aria-label=Notifications]')].forEach((r) => {
    r.style.cssText +=
      ';position:fixed!important;top:100px!important;left:360px!important;right:auto!important;bottom:auto!important;z-index:2147483647!important;';
  });
  ```
  Because it dismisses in 5s, re-trigger the toast immediately before the
  screenshot/query; a click-the-Retry-then-observe flow is timing-flaky — fire it
  via `button.click()` in `eval` right after re-triggering, or extend the toast
  duration.
- **D6. `agent-browser screenshot` can WEDGE the daemon; `eval`/`get` still work.**
  agent-browser is a daemon (`~/.agent-browser/default.sock`, one serialized
  socket). A screenshot RPC that is interrupted — a mis-invoked flag, a command
  the harness auto-backgrounds then kills, `--full` on a giant page — leaves the
  socket half-consumed, and every later `screenshot` fails with
  `Resource temporarily unavailable (os error 35)` / `CDP response channel closed`
  while `eval`/`get url` keep working. **Not** a display-sleep or permission issue.
  - **Works**: reset with `agent-browser close --all` (respawns the daemon), or
    skip the daemon entirely (D7).
- **D7. ✅ WORKS — raw-CDP screenshot, bypasses the daemon.**
  `scripts/cdp-screenshot.sh [--port 9222] [--out x.png] [--full] [--check]`
  opens its own ws to the target, does one `Page.captureScreenshot`, closes
  (\~60ms). Immune to the D6 wedge, and **verified robust when the display is
  ASLEEP and when the window is MINIMIZED/occluded** (Chromium forces a compositor
  frame). Use it for Electron evidence and as a preflight (`--check` → exit 0 iff a
  real, non-black frame was captured). Needs repo `node_modules/ws` (resolved via
  NODE\_PATH by the wrapper).
- **D8. OS `screencapture` is BLACK when the display is asleep/locked/screensaver.**
  Distinct from D6/D7: `screencapture` (and `capture-app-window.sh`, osascript
  grabs) captures the physical framebuffer, so an idle-slept display → a uniformly
  black PNG (mean/max=0; a full-screen black frame has a telltale identical byte
  size). Permission can be fine. Gate with `scripts/check-screen-recording.sh`
  (checks `CGPreflightScreenCaptureAccess` + a real-frame blackness probe) and keep
  the display awake for the whole run: `caffeinate -dimsu &` (or `caffeinate -u`
  to wake it). CDP capture (D7) does not have this problem.

---

## E. Env / ports

- **E1. Don't `eval "$(init-dev-env.sh env)"` just for `APP_URL`.** It can
  clobber `PATH` in that shell (breaks `awk`/`head`/`sort`/`tr`, even
  `agent-browser` inside a subshell loop). Hardcode the known URL
  (`http://localhost:20874`) or export only the one var you need.
- **E2. SPA port is configurable to coexist with another worktree.** Vite binds
  `SPA_PORT||9876`; Next proxies `VITE_DEV_PORT||9876`. Pass `SPA_PORT=9877` to
  `init-dev-env.sh dev` (it exports `VITE_DEV_PORT=$SPA_PORT`) so both agree and
  you don't fight a worktree already on 9876.
