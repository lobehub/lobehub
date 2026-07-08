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

### A7. ✅ WORKS — render a message-attached error card (hetero guide, AsyncError) by in-memory store dispatch

- To render an error state that lives on a **chat message** (e.g. the heterogeneous
  `overloaded` / `interrupted` guide card), no network fault or real agent run is
  needed — inject the error straight into the chat store, **in-memory, no DB write**:
  ```js
  // agent-browser --cdp <port> eval --stdin
  var c = window.__LOBE_STORES.chat();
  var id = 'tmp_probe';
  // 1. create a temp assistant message (in the ACTIVE conversation)
  c.internal_dispatchMessage({
    id,
    type: 'createMessage',
    value: { role: 'assistant', content: 'partial work UNIQUE_MARKER', provider: 'claude-code' },
  });
  // 2. attach the error whose `body.code` drives the card
  c.internal_dispatchMessage({
    id,
    type: 'updateMessage',
    value: {
      error: {
        type: 'AgentRuntimeError',
        message: 'API Error: Connection closed mid-response.',
        body: {
          agentType: 'claude-code',
          code: 'interrupted',
          message: 'API Error: Connection closed mid-response.',
        },
      },
    },
  });
  ```
  This renders the real component (real i18n) in the running app. `code: 'overloaded'`
  → OverloadedState; `code: 'interrupted'` → InterruptedState; etc. Clean up with
  `internal_dispatchMessage({ id, type: 'deleteMessage' })`.
- **No persistence / no side effects**: `internal_dispatchMessage` is the optimistic
  in-memory path (same as `optimisticCreateTmpMessage`). Nothing hits the DB, and a
  reload clears it. Safe even against a **real** account's synced data — do it in an
  isolated `electron-dev.sh start <id>` instance (copied login) to be extra safe.
- **Suppress auto-actions on purpose**: the hetero auto-retry only arms when
  `getRetryScopeId(messageId)` finds a `user` ancestor in `dbMessages`. A tmp message
  is NOT in `dbMessages`, so scope resolves `undefined` → the card renders in its
  **manual** state (retry button, no countdown) and **does not auto-fire** (won't spawn
  a real CLI). To exercise the auto-retry countdown live you'd need a real user→assistant
  chain in `dbMessages`; otherwise cover the countdown with the component RTL test.
- **Gotcha — `messagesMap` landing is unreliable to assert; the render is the truth.**
  `internal_dispatchMessage` (no explicit context) targets the active conversation and
  the message may not show up where a naive `Object.keys(messagesMap)` scan looks, yet
  it still renders. Verify by the DOM, not by the store map.
- **Gotcha — `document.body.innerText` keyword match false-positives in long chats.**
  The conversation's own text (and the right-hand diff/review panel) frequently contains
  your assert strings (e.g. `连接中断`, `重试`, `Retry`). Match on a **unique injected
  marker** instead, `scrollIntoView` its node, then **open the screenshot with Read** to
  confirm the card (Case 1 rule). Find + scroll to the node:
  ```js
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null),
    n,
    hit;
  while ((n = w.nextNode())) {
    if (n.nodeValue.indexOf('UNIQUE_MARKER') >= 0) {
      hit = n;
      break;
    }
  }
  var el = hit.parentElement;
  for (var i = 0; i < 6 && el.parentElement; i++) el = el.parentElement;
  el.scrollIntoView({ block: 'center' });
  ```

### A8. ✅ WORKS — trigger a REAL failed load-more via store action when scroll/observer won't trip

- **Situation**: verifying an infinite-scroll `loadMoreError` inline retry row. The
  `IntersectionObserver` won't fire because the seed data is a short list that fits
  the viewport without scrolling (virtua renders no scrollable overflow), so
  `scrollTop = scrollHeight` scrolls nothing and `loadMore` is never called.
- **Doesn't work**: scrolling any element to the bottom — with only 2 rows there is
  no scroll container (`scrollHeight <= clientHeight`), and virtua's sentinel never
  intersects.
- **Works — two parts**:
  1. **Force pagination with tiny seed data via HMR**: lower the component's page-size
     const so a small dataset paginates. `AgentTopicManager` `PAGE_SIZE = 30` → `2`,
     then an agent with 3 topics loads page-1 = 2, `hasMore = true`.
  2. **Call the real store action directly** (bypasses the observer, but runs the real
     fetch + real `catch`): `window.__LOBE_STORES.<store>` is a bound hook — CALL it to
     get live state + actions (`.getState`/`.setState` are NOT exposed, C1).
     ```js
     // agent-browser --session <s> eval
     var c = window.__LOBE_STORES.chat();
     await c.loadMoreAgentTopicsView(); // hits the injected getTopics(current>0) throw
     // → real catch sets agentTopicsViewMap[key].loadMoreError → inline AsyncError row renders
     ```
  Pair the service injection (A4, throw only when `params.current > 0` so page-1 loads
  and page-2 fails) with a **call counter** to prove the observer gate does NOT loop:
  `(globalThis).__loadMoreCalls = (…||0)+1` inside the throw; after the failure, wait a
  few seconds and assert `window.__loadMoreCalls` stays `1` (no runaway re-trigger).
- **Caveat**: calling the action directly proves the render + the real error code path +
  no-runaway, but NOT the observer's `!loadMoreError` gate under real scroll (the gate
  lives in the component's IntersectionObserver callback). To exercise the gate live you
  need a real scrollable list — seed `> PAGE_SIZE` visible-source topics on one agent.
- **Gotcha — the manager view filters by source (`来源: 对话`) by default.** Topics with a
  non-conversation source/trigger show `0` even though the agent owns them in the DB;
  click **清空筛选 / Clear filters** (or `setStatus('all')` + clear) to reveal them.

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

### C1b. ✅ WORKS — expose `setState` via HMR to drive a REAL identity/scope change (login repro)

- **Situation**: verifying behavior on an identity/cache-scope change (e.g. login,
  `useCacheScope` = `${userId}:${workspaceId}`) on the ALREADY-LOADED app, without a
  real OAuth flow. Cold-boot repro is timing-flaky under machine load; the faithful,
  deterministic path is to flip `userId` on the live app.
- **Doesn't work**: `window.__LOBE_STORES.user()` returns `getState()` (actions but no
  `setState`); there is no public `setUserId` action to call.
- **Works**: patch the dev-only exposer `src/store/middleware/expose.ts` (HMR) to also
  attach `setState`, then drive the store from `eval`:
  ```ts
  // expose.ts, temporary — REMOVE after: git checkout -- src/store/middleware/expose.ts
  const handle = () => store.getState();
  (handle as any).setState = (store as any).setState;
  window.__LOBE_STORES[name] = handle as any;
  ```
  `expose()` only runs at store creation, so reload the renderer once after the edit so
  stores re-expose with the handle. Then:
  ```js
  var u = window.__LOBE_STORES.user;
  var c = u().user || {};
  u.setState({ user: Object.assign({}, c, { id: 'probe_scope_0705' }) }); // → scope flips
  ```
  In-memory only (no DB write); a reload restores the real id. Revert the file after.

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
- **D6. The singleton hover action bar is hard to drive; its icons are
  `div[role=button]`, NOT `<button>`.** The per-message action bar
  (`SingletonMessageActionsBar`) is one portal that moves via DOM + a
  freeze/commit `MutationObserver`, so it appears only while hovering and
  re-hides on the next commit tick. Gotchas that wasted a run:
  - `host.querySelectorAll('button')` returns 0 — the ActionIcon items render as
    `<div role="button">`. Query `[role="button"]` (or the broad
    `button,[role=button],[class*=ActionIcon]`).
  - Between two evals the bar can vanish (commit tick). Do hover + inspect + act
    in as few steps as possible.
  - ✅ WORKS to open the overflow menu on a message and read its items:
    ```bash
    S="--session s9224 --cdp 9224"
    agent-browser $S hover "#<messageId>" # ChatItem root id = message id
    sleep 1.5
    # click the LAST role=button in the host = the "…" overflow trigger
    agent-browser $S eval '(function(){var h=document.querySelector("[data-singleton-message-action-bar-host]");var b=h&&h.querySelectorAll("[role=button]");if(!b||!b.length)return "no-bar";b[b.length-1].click();return "clicked";})()'
    sleep 1
    agent-browser $S screenshot /abs/menu.png
    agent-browser $S eval '(function(){var t=[];document.querySelectorAll("[role=menuitem],li").forEach(function(i){var s=(i.innerText||"").trim();if(s)t.push(s);});return JSON.stringify(Array.from(new Set(t)));})()'
    ```
    A programmatic `.click()` on the ellipsis DOES open the antd dropdown (it sets
    `data-popup-open`, which also freezes the bar so it won't vanish). The action
    labels are localized (`分享`/`多选`/`删除` = share/select/del).
- **D7. To get a _finished_ hetero (CC/Codex) turn that ENDS on a tool block**
  (last child has tools → `getGroupLatestMessageWithoutTools` returns undefined,
  the `!contentId` action-bar path): send a single long tool call (e.g.
  `用 Bash 工具运行 sleep 20`) and, the moment the group's last child is a running
  tool, call `stopGenerateMessage()` in the SAME eval to avoid the race where CC
  appends a trailing text summary (which would give it a text last-block and a
  defined contentId). Poll-then-stop-atomically:
  ```bash
  agent-browser $S eval '(function(){var c=window.__LOBE_STORES.chat();var t=c.activeTopicId;var a=c.messagesMap["main_"+c.activeAgentId+"_"+t]||[];var g=a.filter(m=>m.role==="assistantGroup").pop();var lc=g&&g.children&&g.children.at(-1);var running=Object.values(c.operations||{}).some(o=>o.status==="running");if(lc&&(lc.tools||[]).length&&running){c.stopGenerateMessage();return "STOPPED";}return "wait";})()'
  ```
- **D8. `agent-browser screenshot` can WEDGE the daemon; `eval`/`get` still work.**
  agent-browser is a daemon (`~/.agent-browser/default.sock`, one serialized
  socket). A screenshot RPC that is interrupted — a mis-invoked flag, a command
  the harness auto-backgrounds then kills, `--full` on a giant page — leaves the
  socket half-consumed, and every later `screenshot` fails with
  `Resource temporarily unavailable (os error 35)` / `CDP response channel closed`
  while `eval`/`get url` keep working. **Not** a display-sleep or permission issue.
  - **Works**: reset with `agent-browser close --all` (respawns the daemon), or
    skip the daemon entirely (D9).
- **D9. ✅ WORKS — raw-CDP screenshot, bypasses the daemon.**
  `scripts/cdp-screenshot.sh [--port 9222] [--out x.png] [--full] [--check]`
  opens its own ws to the target, does one `Page.captureScreenshot`, closes
  (\~60ms). Immune to the D8 wedge, and **verified robust when the display is
  ASLEEP and when the window is MINIMIZED/occluded** (Chromium forces a compositor
  frame). Use it for Electron evidence and as a preflight (`--check` → exit 0 iff a
  real, non-black frame was captured). Needs repo `node_modules/ws` (resolved via
  NODE\_PATH by the wrapper).
- **D10. OS `screencapture` is BLACK when the display is asleep/locked/screensaver.**
  Distinct from D8/D9: `screencapture` (and `capture-app-window.sh`, osascript
  grabs) captures the physical framebuffer, so an idle-slept display → a uniformly
  black PNG (mean/max=0; a full-screen black frame has a telltale identical byte
  size). Permission can be fine. Gate with `scripts/check-screen-recording.sh`
  (checks `CGPreflightScreenCaptureAccess` + a real-frame blackness probe) and keep
  the display awake for the whole run: `caffeinate -dimsu &` (or `caffeinate -u`
  to wake it). CDP capture (D9) does not have this problem.

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

### E3. ✅ WORKS — deep-link to an authed SPA route bounces to /signin; load `/` then soft-nav

- **Situation**: after `setup-auth.sh web-seed`, `agent-browser open <app>/` lands
  authed, but a hard `open <app>/agent/<id>/docs` (or any deep authed route)
  redirects to `/signin?callbackUrl=...` — the deep-route hard-load runs an
  SSR/middleware auth check the seeded cookie doesn't satisfy, even though `/`
  is authed and the agent is owned by the seeded user.

- **Doesn't work**: hard-loading the deep route directly; repeated deep hard-loads
  can also drop the seeded cookie so even `/` starts bouncing (re-run `web-seed`).

- **Works**: hard-load `/` (authed), confirm by screenshot (not the app-probe auth
  JSON — it false-negatives here, returns `isSignedIn:false` on an authed page),
  then **client-side soft-nav** with no server round-trip:

  ```bash
  agent-browser eval "history.pushState({},'','/agent/<id>/docs'); window.dispatchEvent(new PopStateEvent('popstate')); 'nav'" --session lobehub-dev
  ```

  react-router picks up the popstate and renders the route in-context with the
  already-hydrated auth. Right-panels that render at a _layout_ level do NOT see a
  child route's `:param` via `useParams()` — read it from `location.pathname` if
  you need it.

- **D11. ✅ WORKS — catch a BRIEF blank/transient frame (sub-second) that screencast misses.**
  Verifying a momentary full-screen blank (e.g. a React subtree unmounting to `null` for
  \~150–350ms during a scope change): `Page.startScreencast` only emits frames on a VISUAL
  CHANGE, so a _static_ blank produces NO frame — you see a time GAP in the manifest, not a
  blank image. Single timed `cdp-screenshot` also loses the race (its own \~200ms latency
  overshoots) and `captureScreenshot` can return the prior surface.
  - **Works — two complementary probes**:
    1. **DOM proof (deterministic)**: sample `document.getElementById('root').innerText.trim().length`
       at 150/350/600ms after the trigger via one `eval` returning a Promise. A full unmount
       drops it to `0`, then it recovers — unambiguous, load-independent. (Fixed vs broken:
       `6064 → 0 → 5646` vs `6089 → 6002 → 6042` never-0.)
    2. **Freeze the pixels**: to actually capture the blank image, keep the blank ON SCREEN
       longer by re-triggering every \~80ms (e.g. flip `userId` to a fresh value each tick so a
       `key={scope}` gate stays remounted), while firing raw CDP `Page.captureScreenshot` every
       80ms over the same window. Blank frames come back tiny (\~34KB jpeg) vs content (\~294KB);
       convert + Read one to confirm. (A raw-CDP forced capture DOES render a static frame; the
       trick is holding the state, not the capture.)
  - Byte-size is a reliable auto-flag for near-uniform frames (blank/loading), but two
    different near-uniform states (dark loading-screen vs blank) can both be small — always
    Read the frame to tell them apart (Case 1 rule).

### E4. ✅ WORKS — keep Electron pool `LOBE_IPC_ID` short

- **Situation**: manually starting an isolated Electron dev instance with a
  descriptive `LOBE_IPC_ID` such as `lobehub-desktop-dev-manual-selection-2`.
  The main process builds a Unix socket path under `$TMPDIR`, and macOS rejects
  overlong socket paths.
- **Doesn't work**: long IPC ids can crash Electron at bootstrap with
  `listen EINVAL ... <id>-electron-ipc.sock`, before any renderer/CDP evidence is
  available.
- **Works**: use the numeric `electron-dev.sh start <id>` pool path, or keep
  manual IPC ids very short, e.g. `LOBE_IPC_ID=lhmsel2`.

### E5. ✅ WORKS — no-Docker fallback stack for the isolated no-.env env

- **Situation**: `init-dev-env.sh setup-db` needs Docker (paradedb + redis images), but
  Docker Desktop's VM can wedge indefinitely (`no route to host` to 192.168.65.x, empty
  vm/console.log). Verified working substitute:
  - **Postgres**: local brew Postgres 17 (pgvector available). The only paradedb-specific
    migrations are `0090_enable_pg_search` / `0093_add_bm25_indexes_with_icu` — no-op them
    in the worktree (`SELECT 1;`), everything else applies clean.
  - **Redis is a hard dependency of Better Auth sign-in** — with a dead REDIS\_URL the seed
    login 500s (`[Better Auth]: Error: Connection is closed`). `brew install redis`,
    `redis-server --port 6380 --daemonize yes`.
  - **S3**: `s3rver` (npm) on 29000 with a CORS config for the bucket. Its presigned-URL
    validation only accepts key id `S3RVER` (secret `S3RVER`) — `allowMismatchedSignatures`
    does NOT rescue an unknown access key id (403 on the browser preflight). Set the dev
    server's `S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY=S3RVER`, `S3_ENABLE_PATH_STYLE=1`,
    `S3_PUBLIC_DOMAIN=http://127.0.0.1:29000/<bucket>`.

### E6. code-inspector-plugin breaks Turbopack compile of Next-served authed pages

- **Situation**: the first AUTHENTICATED render of a Next-served (non-SPA) page whose client
  graph pulls the chat store dies in `next dev` (Turbopack) with Build Error `Resource path
"worker/browser/createWorker.ts" needs to be on project filesystem` (chain: layout →
  GlobalProvider/Query → trpc client → image/chat store → python-interpreter worker).
  Unauthenticated curl 302s BEFORE the client graph compiles, so it false-passes; a fresh
  no-lockfile `pnpm install` can resolve a broken plugin version.
- **Works**: `E2E=1` (or `TEST=1`) — `defineConfig`'s `isTest` skips `codeInspectorPlugin`,
  the only thing it gates. Webpack mode (`next dev --webpack`) is NOT a viable fallback
  (react version mismatch when two next versions are hoisted; `zlib-sync` unresolved for
  discord.js).

### D12. agent-browser daemon serializes commands — `open` queues behind a record-gif loop

- **Situation**: `record-gif.sh` (a screenshot loop) running while you issue
  `agent-browser open <url>` — the daemon socket serializes, the open lands late/out of
  order, and your "during navigation" screenshot actually shows the PREVIOUS page (which can
  look identical to the expected end state — false read).
- **Works**: during any recording loop, navigate with
  `agent-browser eval 'location.href="<url>"'` (fire-and-forget) instead of `open`. To hold
  a streaming loading state on screen, inject a server-side `await sleep(8000)` before the
  slow lookup in the page (\[AGENT-TEST], revert) — TTFB stays \~0.3s so loading.tsx renders
  while the route hangs, giving a wide static-capture window.

---

## F. Running the OSS web surface inside the CLOUD checkout (submodule)

### F1. ✅ WORKS — vite dev EMFILE on a shared machine: serve a BUILT SPA behind a fake vite origin

- **Situation**: `bun run dev` / `vite` in the lobehub submodule dies instantly with
  `EMFILE: too many open files, watch` (node FSWatcher), even with `ulimit -n 245760`
  and `CHOKIDAR_USEPOLLING=1` — happens when another worktree's dev server already
  holds a huge watch set on the same machine.
- **Works**: skip vite dev entirely. `bun run build:spa && bun run build:spa:copy`
  (no watchers), then `PORT=<p> VITE_DEV_PORT=<q> init-dev-env.sh dev-next` (Next dev
  alone starts fine), plus a tiny static server on `<q>` that returns
  `dist/desktop/index.html` for `/` (Next's `fetchViteDevTemplate` fetches the HTML
  template from the vite origin in dev). `build:spa:copy` puts assets under
  `public/_spa` so Next serves the chunks itself.
- **Gotcha**: with the built template, the inline importmap boot script does NOT
  auto-import the entry — after every `open`, boot manually:
  `agent-browser eval 'import("/_spa/assets/index-<hash>.js")'` (find the hash in
  `public/_spa/assets`). Re-run after each rebuild (hash changes).

### F2. Cloud pnpm overrides leak into the submodule app; shim the missing cloud aliases

- **Situation**: in the cloud checkout, `@lobechat/business-*` resolves to CLOUD
  packages; running the OSS Next app then fails with
  `Module not found: Can't resolve '@/libs/redis-client'` (cloud-only module).
- **Works**: create a minimal stub at `lobehub/src/libs/redis-client.ts`
  (`isRedisClientEnabled=()=>false; getRedisClient=async()=>null`), marked
  `[AGENT-TEST] REMOVE`; restart Next (Turbopack won't pick up the new file without
  a restart). Revert after the run.
- Also: better-auth needs a reachable `REDIS_URL`; ioredis failed against a leftover
  redis on 6380 that redis-cli could reach — starting a fresh `redis:7-alpine` on
  6379 and passing `REDIS_URL=redis://127.0.0.1:6379` fixed `Failed to get session`.

### F3. ✅ WORKS — drive workspace-scoped behavior in the OSS build (no cloud UI)

- The workspace context is the `X-Workspace-Id` request header
  (`packages/trpc/src/lambda/context.ts`); the OSS client never sets it and the
  workspace UI hooks are empty business slots (`useActiveWorkspaceId` → null).
- **Works, three layers**:
  1. **API-level**: `fetch("/trpc/lambda/<proc>", {headers:{"X-Workspace-Id": ws}})`
     from `agent-browser eval` (cookies included) hits the real router with real
     RBAC checks.
  2. **RBAC**: workspace member needs rbac rows — seed `rbac_permissions`
     (`agent:create:all` etc.), one `rbac_roles`, `rbac_role_permissions`, and a
     workspace-scoped `rbac_user_roles` row; a 403 "No write access to target
     workspace" proves the check is live.
  3. **UI-level**: patch the slot `src/business/client/hooks/useActiveWorkspaceId.ts`
     to read `localStorage.AGENT_TEST_WS` (keep ALL original exports —
     `getActiveWorkspaceId` too, or the build fails with MISSING\_EXPORT), rebuild the
     SPA, and pre-patch `window.fetch` (BEFORE the manual entry import — the TRPC
     client captures fetch at creation) to add the header. The sidebar then renders
     the real Private/Workspace sections.
- **Production SPA build exposes NO `window.__LOBE_STORES`** — store-action eval is
  dev-build-only; use the TRPC fetch path instead.

### F4. curl "502" on localhost with nothing listening = shell proxy env

- With `http_proxy`/`HTTP_PROXY` set, `curl http://localhost:<port>` returns the
  proxy's 502 instead of connection-refused, faking a "server up but broken" signal.
  Always `curl --noproxy '*'` for local port probes.
