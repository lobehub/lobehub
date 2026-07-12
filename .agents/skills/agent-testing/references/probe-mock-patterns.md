# Probe / Mock Pattern Library

> **Purpose**: the accumulated, verified recipes for probing app/runtime state
> and mocking / faulting network in agent-testing. Every time a probe or a mock
> is **blocked, bypassed, or needs a workaround** during a run, add an item here
> recording what does NOT work and what DOES.
> **Read this before any run that needs to force an error state or inspect
> runtime state.** Each item: Situation / Doesn't work / Works.
>
> **Separate the observation from the explanation.** A full audit of this file (source read +
> live re-run against `agent-browser 0.26.0` and the dev server) found that several items'
> observations were real but their stated mechanism was invented after the fact — a symbol
> that never existed (`getRetryScopeId`), an error code the code rejects (`interrupted`), a
> `PATH` clobber the script cannot perform. Two "doesn't work" items (A1, A2) turned out to
> work fine; the original runs had measured the wrong signal. A wrong mechanism is worse than
> none: it sends the next reader to fix the wrong thing. When you add an item, cite
> `file:line` for any mechanism claim, and if you only saw a symptom, write
> "cause not established" instead of guessing.

---

## A. Forcing a fetch to FAIL (error-state testing)

### A1. ✅ `network route --abort` DOES intercept this app's TRPC — the old note measured the wrong thing

Re-tested end-to-end against the running dev server. The previous claim ("blocks nothing —
815 requests still returned 200") was wrong three times over:

- **The glob never matched.** `**/trpc/**` matches nothing. Only an absolute-URL prefix with
  a trailing `*` matched reliably; `**/x`, `**/*` and `*/trpc/*` all failed on a nested path.
  Use `route "<origin><path-prefix>*" --abort` — the trailing `*` is required to cover TRPC's
  `?input=…` query string.
- **The app swallows the failure, so a working abort still "looks like" a 200.** With
  `route "http://localhost:<port>/trpc/lambda/user.getUserState*" --abort` installed, the
  fetch really is killed — yet the store action still resolves:
  ```text
  with route:  fetchOutcomes ["REJECTED_Failed to fetch"]  storeActionOk 1  storeActionErr null
  no route:    fetchOutcomes ["resolved_200","resolved_200"]  storeActionOk 1
  ```
  Never judge interception by the action's promise or by the UI. Wrap `window.fetch` and
  record each request's own outcome (snippet in A2).
- **`network requests` under-reports.** In a window where the page-realm wrapper counted
  thousands of fetches (one of them TRPC), `agent-browser network requests` listed **1 request
  and 0 TRPC**. It is not ground truth for "did the request happen".

### A2. ✅ A post-load `window.fetch` override DOES see this app's TRPC

- The old note claimed the TRPC client "captures the `fetch` reference at client-creation".
  It does not: `packages/trpc/src/client/lambda.ts:104-108` passes a wrapper that calls the
  **ambient** `fetch` per request (consumed by `httpBatchLink`/`httpLink`, lines 148-149), so
  a later `window.fetch = …` reassigns exactly the binding it resolves.
- Measured on the running app: install the override post-load, force a real call with
  `window.__LOBE_STORES.user().refreshUserState()`, and the override sees the TRPC request.
  `agent-browser eval` shares the page realm — confirmed separately on a static page whose own
  script calls ambient `fetch` (`REAL_FETCH_200` before the override, `THREW_OVERRIDDEN` after).
- **Use this shape**; it records the _fetch's_ outcome, the only trustworthy signal:
  ```js
  if (!window.__W) {
    window.__W = 1;
    window.__R = [];
    const of = window.fetch;
    window.fetch = function (...a) {
      const p = of.apply(this, a);
      if (String(a[0]).includes('/trpc/'))
        p.then(
          (r) => window.__R.push('resolved_' + r.status),
          (e) => window.__R.push('REJECTED_' + e.message),
        );
      return p;
    };
  }
  ```
  The `__W` guard matters: re-running the snippet in a second `eval` wraps the wrapper and
  the next call dies with `Maximum call stack size exceeded`.
- If you point `agent-browser` at the **Debug Proxy** URL instead of the local origin, the SPA
  runs in an iframe and a top-frame override lands in a different realm. That — not the client
  — is what a genuine bypass would look like.

### A3. `set offline` shows Chrome's page, not the component error

- **Doesn't work for component errors**: `agent-browser set offline on` trips
  Chrome's document-level offline interstitial ("Reconnect to Wi-Fi"), not the
  app's `AsyncError`. Its "Reload" button also false-matches error-copy greps.
  (Offline also breaks lazy route-chunk loading → hard-nav fallback → Chrome page.)
- **Re-confirmed** (`set offline on` + `reload`): `document.body.innerText` comes back as
  `按空格键即可开始游戏 … 重新连接到 Wi-Fi 网络 … ERR_INTERNET_DISCONNECTED`. The dino-game
  and Wi-Fi copy are exactly the kind of text a naive error-copy grep matches.

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
  (`src/store/utils/runMutation.ts:82-88`) calls `setStatus('failed')` then `onError`; the task
  detail action supplies `internal_setTaskSaveStatus`, so the state lands in
  **`taskSaveStatusMap[id]`** (a per-task map, not a scalar `taskSaveStatus`) and `saveToast`
  fires. Retryability comes from `normalizeAsyncError`, whose only non-retryable statuses are
  **401 and 403** (`src/libs/swr/normalizeError.ts:26`) plus an explicit
  `meta.shouldRetry === false`. So `httpStatus:500` ⇒ retryable ⇒ the toast shows a Retry
  action; 401/403 suppress it.
- **Gotcha — reverting the injection triggers a FULL page reload.** `git checkout --`
  on a service file makes Vite do a full reload (not just HMR), so the SPA resets to
  a blank Main Layout (Case 1 trap: a blank shell with only the `Debug ID` tag).
  After reverting, **re-navigate** (`agent-browser open .../task/<id>`) and re-fetch
  element refs before continuing the recovery test.

### A7. ✅ WORKS — render a message-attached error card (hetero guide, AsyncError) by in-memory store dispatch

- To render an error state that lives on a **chat message** (e.g. the heterogeneous
  `overloaded` guide card), no network fault or real agent run is
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
        message: 'Overloaded',
        body: {
          agentType: 'claude-code',
          code: 'overloaded',
          message: 'Overloaded',
        },
      },
    },
  });
  ```
  This renders the real component (real i18n) in the running app. Clean up with
  `internal_dispatchMessage({ id, type: 'deleteMessage' })`.
- **`code` must be one of four values, or you get no guide card.**
  `isHeterogeneousAgentStatusGuideError` (`src/features/Conversation/Error/heterogeneous.ts:13-31`)
  requires `agentType` ∈ {`claude-code`, `codex`} **and** `code` ∈ {`auth_required`,
  `cli_not_found`, `overloaded`, `rate_limit`}. Anything else falls through to the generic
  error path. The switch
  (`src/features/Electron/HeterogeneousAgent/StatusGuide/index.tsx:28-44`) maps AuthRequired →
  `AuthRequiredState`, RateLimit → `RateLimitState`, Overloaded → `OverloadedState`,
  **default → `CliInstallState`**. There is no `InterruptedState`, and `interrupted` is not a
  `HeterogeneousAgentSessionErrorCode` at all (it is a `completionReason` / run-`status` value
  elsewhere) — an earlier version of this note used it as the example, and it would have
  rendered nothing of the sort.
- **No persistence / no side effects**: `internal_dispatchMessage` is the optimistic
  in-memory path (same as `optimisticCreateTmpMessage`). Nothing hits the DB, and a
  reload clears it. Safe even against a **real** account's synced data — do it in an
  isolated `electron-dev.sh start <id>` instance (copied login) to be extra safe.
- **Suppress auto-actions on purpose**: the hetero auto-retry only arms when a retry scope
  resolves. `src/features/Conversation/Error/index.tsx:260-262` computes
  `retryScopeId ?? getDisplayMessageById(data.id)?.parentId`, and `useHeterogeneousAutoRetry`
  gates on `!!scopeId`. A tmp message has no `parentId`, so the scope is `undefined` → the card
  renders in its **manual** state (retry button, no countdown) and **does not auto-fire**
  (won't spawn a real CLI). (There is no `getRetryScopeId` helper — an earlier version of this
  note invented one. The mechanism is a plain `parentId` lookup, not an ancestor walk.) To
  exercise the countdown live you'd need a real user→assistant chain; otherwise cover it with
  the component RTL test.
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
- **Gotcha — the manager view filters by source (`来源: 对话`) by default.** The store's default
  filter is `triggers: ['chat']` (`src/features/AgentTopicManager/store.ts:49-51`; the code calls
  it the **trigger** filter, the UI labels it 来源 /source), so topics with a non-chat trigger
  show `0` even though the agent owns them in the DB; click **清空筛选 / Clear filters** (or
  `setStatus('all')` + clear) to reveal them.

---

## B. Cache / stale state that MASKS the failure

### B1. A failed revalidation cannot show an error once the data has settled

- **Situation**: a surface loaded successfully once caches the last-good value
  (e.g. `[]`). On a later failed fetch, `AsyncBoundary` correctly keeps the
  settled content and does NOT show the error (by design: background error must
  not blow away loaded content). So your injected failure shows the old content,
  not the error.
- **Where the behavior lives**: `AsyncBoundary` itself, not the persisted cache.
  `src/components/AsyncBoundary/index.tsx:76,93` gate the error branch on
  `if (error && !hasSettled)` where `hasSettled = data !== undefined`. The persisted cache's
  only role is making `data` non-`undefined` on first mount.
- **This masking runs deeper than the boundary.** With the TRPC fetch aborted at the network
  layer (A1), `refreshUserState()` still resolved successfully — the rejection never surfaced
  to the caller. Assume a failure you inject is invisible until you prove otherwise at the
  fetch itself.
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

### B2. SWR retries for \~30s before the error settles

- **Situation**: `useClientDataSWR` retries failed fetches with exponential backoff.
  During retries `isLoading` is true → you screenshot a skeleton, not the error.
- **Mechanism**: there is no `errorRetryCount` prop. `src/libs/swr/index.ts:31-45` supplies a
  custom `onErrorRetry` that bails on `retryCount >= 5`, with
  `delay = min(1000 * 2^retryCount, 30_000)`. SWR pre-increments the counter before calling the
  handler (`swr/dist/index/index.mjs:493` → `(opts.retryCount || 0) + 1`), so the handler sees
  1..5 and schedules **4 retries** at 2s + 4s + 8s + 16s = **\~30s** cumulative. (The old
  "5× / \~31s" reading assumed the counter starts at 0.)
- **Works**: wait \~35s after load for retries to exhaust, THEN screenshot. (Or
  inject `meta.shouldRetry=false` to skip retries — but that also hides the Retry
  button, because `normalizeAsyncError` sets `retryable = false` for it.)

### B3. In-memory SWR cache survives `open`; persisted cache survives everything

- `open about:blank` then `open <target>` forces a fresh JS context (clears
  in-memory SWR) but does NOT clear persisted storage — you still need B1 for a
  true cold load.
- **Verified**: a marker set only via `eval` reads back `undefined` after the round-trip while
  `localStorage` survives. Set the marker from `eval`, never from the page's own script — an
  inline script re-runs on the second `open` and re-creates it, which reads as "the context
  was preserved".
- The cache persists to **two durable tiers** (`src/libs/swr/localStorageProvider.ts`):
  IndexedDB for the big collections and localStorage for small shells. That is why B1's
  cold-load recipe clears localStorage, sessionStorage, IndexedDB **and** the Cache API.

---

## C. Probing app / store runtime state

### C1. `window.__LOBE_STORES.<name>` has no `.getState` — CALL it instead

- **Doesn't work**: `window.__LOBE_STORES.page.getState()`. The exposed value is neither the
  store nor the hook: `src/store/middleware/expose.ts:11` assigns
  `window.__LOBE_STORES[name] = () => store.getState()`, a plain arrow function with no
  `.getState` property.
- **Works**: call it — `window.__LOBE_STORES.page()` returns the state snapshot, actions
  included. An earlier version of this note said "state isn't readable from it", which was
  wrong and contradicted C1b.

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

### C3. Console capture works — an empty `agent-browser console` means something else

- The old note said console capture "returned nothing this run" and told you to avoid it.
  Re-tested on 0.26.0: `agent-browser console` returned both a page-script `[log]` line and one
  emitted later from `eval`. It works.
- `app-probe.sh errors` is a different story: like `app-probe.sh auth`, it talks to the
  **Electron CDP endpoint on 9222**, not to your `agent-browser` browser session. Against a web
  session it fails with `All CDP discovery methods failed for 127.0.0.1:9222` — which is not
  "console capture is unreliable", it is "you pointed the probe at Electron".
- The debug-global (C2) is still the better tool for reading component state; use console for
  what console is for.

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

### C6. ✅ WORKS — read a topic's metadata (workingDirectoryConfig etc.) from the chat store, and reset to a fresh topic

- **Doesn't work**: `chat().topicsMap[topicId]` / `chat().topicDataMap[topicId]` — there is
  no per-topic-id map. `topicDataMap` is keyed by **view key** (`agent_<agentId>`), and each
  value is a paginated view object (`{ items, total, hasMore, … }`), not a topic.
- **Works** (verified while E2E-testing `git worktree add` side-effect recording):
  ```js
  var c = window.__LOBE_STORES.chat();
  var view = c.topicDataMap['agent_' + agentId];
  var topic = (view.items || []).find(function (x) {
    return x.id === c.activeTopicId;
  });
  topic.metadata.workingDirectoryConfig; // ← e.g. git.activeWorktree written by recordGitCommandEffects
  ```
- **Fresh topic without touching the UI**: `await c.openNewTopicOrSaveTopic()` — with an
  active topic it saves/exits to the agent's no-topic compose state (activeTopicId → null),
  so the next send creates a new topic. Chain per-case fixtures this way instead of clicking
  "Start New Topic". The contenteditable ref changes after the switch — re-run
  `snapshot -i -C` before typing.
- Full E2E loop this enabled: E11 fixture agent (`heterogeneousProvider: { type: 'claude-code' },
executionTarget: 'local'` in `agencyConfig`) + one message per case asking CC to run a
  specific shell command → poll `chat().operations` for `running === 0` → assert the
  topic's metadata via the probe above. A real CC one-command turn completes in \~10–20s.

---

## D. agent-browser / CDP mechanics

- **D1. `screenshot` honours a relative path (0.26.0) — but still pass an absolute one.**
  Re-tested: `agent-browser screenshot rel.png` saved to the **caller's cwd**, printed
  `✓ Screenshot saved to rel.png`, and wrote nothing under `~/.agent-browser/tmp/screenshots/`.
  The old "silently ignored" claim is false. An absolute path is still the right habit — the
  cwd of a step in a longer script is easy to lose track of.
- **D2. CDP port is ephemeral.** The browser runs with `--remote-debugging-port=0`; for raw
  CDP, read `DevToolsActivePort` in the browser user-data-dir. Note there is **no top-level
  `cdp-url` command** — it is a `get` subject: `agent-browser get cdp-url` (which does return
  a `ws://127.0.0.1:<port>/devtools/browser/…` URL). An earlier version of this note reported
  `agent-browser cdp-url` "returned empty"; it returned empty because it is not a command.
- **D3. offline is `agent-browser set offline on|off`** (under `set`, with
  `viewport`/`geo`/`headers`), not a top-level `offline` command.
- **D4. `wait --load networkidle` HANGS during a retry loop** (network never
  idles) and can blow the command timeout — use a fixed `wait <ms>` instead when
  a fetch is stuck retrying. **Confirmed with a control**: on a page polling every 300ms the
  command was still blocked after 20s; on an idle page it returned `rc=0` immediately. (macOS
  has no `timeout(1)` — don't try to bound it with coreutils that aren't there.)
- **D5. base-ui `toast` lives in a portal, auto-dismisses in \~5s, and can be
  occluded by the dev debug widget.** The portal viewport carries `aria-label="Notifications"`
  and base-ui's default `timeout` is `5000`. `snapshot -i` does NOT reliably surface the
  portal's action buttons (the `重试`/Retry ref came back empty); read the toast
  via `eval` DOM query instead. The occluding widget is the **DevPanel float button**
  (`src/features/DevPanel/features/FloatPanel.tsx`, fixed bottom-right, desktop/Electron only —
  the SPA disables it). There is no FPS meter in this app, despite what an earlier version of
  this note said. Relocate the toast region for a clean shot:
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
  agent-browser is a daemon with **one socket per session**, `~/.agent-browser/<session>.sock`
  (verified: two live sessions ⇒ two sockets; `default.sock` exists only while the _default_
  session runs). Sessions coexist, so a wedge is scoped to one session, not the whole tool.
  Commands on a given socket are serialized. A screenshot RPC that is interrupted — a
  mis-invoked flag, a command the harness auto-backgrounds then kills, `--full` on a giant
  page — leaves the socket half-consumed, and every later `screenshot` fails with
  `Resource temporarily unavailable (os error 35)` / `CDP response channel closed`
  while `eval`/`get url` keep working. **Not** a display-sleep or permission issue.
  - **Not reproduced on 0.26.0** with the obvious trigger: SIGKILLing the client 150ms into a
    `screenshot` left the session healthy (`eval`, `get url`, and a follow-up `screenshot` all
    succeeded). Real, but rarer than the note implies — don't assume a wedge without seeing
    the error string above.
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

- **E1. ⚠️ This item was wrong on both counts — do not trust its reasoning.**
  It claimed `eval "$(init-dev-env.sh env)"` "can clobber `PATH`". It cannot: the `env`
  subcommand prints only the keys in `env_keys()` (`init-dev-env.sh:178-204`), and the string
  `PATH` does not appear anywhere in the script. It also told you to hardcode
  `http://localhost:20874`; `SERVER_PORT` is **randomly allocated per workspace** in
  20000-40000 (falling back to 3010) and persisted to `.records/env/agent-testing-ports.env`,
  so `20874` was one machine's old port (this workspace is on 21912) and it appears nowhere
  else in the repo. **Works**: read the port from that file, or export just the one var —
  `export APP_URL="$(init-dev-env.sh env | sed -n 's/^APP_URL=//p')"`. Whatever broke
  `awk`/`head` in the original run was never diagnosed.
- **E2. SPA port is configurable to coexist with another worktree.** Vite binds
  `SPA_PORT||9876`; Next proxies `VITE_DEV_PORT||9876`. Pass `SPA_PORT=9877` to
  `init-dev-env.sh dev` (it exports `VITE_DEV_PORT=$SPA_PORT`) so both agree and
  you don't fight a worktree already on 9876.

### E3. Deep-linking to an authed SPA route — NOT reproduced; soft-nav is still the safer path

- **Original claim**: after `setup-auth.sh web-seed`, a hard `open <app>/agent/<id>/docs`
  redirects to `/signin?callbackUrl=...` while `/` stays authed.

- **Did not reproduce** against the current dev server with a seeded web session
  (`isSignedIn: true`, `userId: user_agent_testing_001`). Hard-loading `/settings/common` and
  the note's exact shape `/agent/<real-id>/docs` both landed on the route itself, with no
  `/signin` and no `callbackUrl`. Either it was fixed, or the original run's cookie state
  differed. Don't budget for the bounce; check for it.

- **Still true and still useful**: `app-probe.sh auth` "false-negatives" here because it talks
  to the **Electron CDP endpoint on 9222**, not to your web browser session — it fails with
  `All CDP discovery methods failed for 127.0.0.1:9222`. Read the auth state out of the page
  instead: `window.__LOBE_STORES.user()` → `{ isSignedIn, user.id }`.

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
  \~150–350ms during a scope change): `Page.startScreencast` emits one frame when it starts and
  then only on a VISUAL CHANGE, so a _static_ blank produces no further frames — you see a time
  GAP in the manifest, not a blank image. (Measured: 3s of a static page → **1** frame, the
  initial one; 6 background flips → **6** frames. The old note said "NO frame", which misses
  the initial one and can look like the screencast never started.)
  Single timed `cdp-screenshot` also loses the race (its own \~200ms latency
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

### E8. ✅ WORKS — a git-worktree checkout needs its OWN `pnpm install`, not a symlinked `node_modules`

- **Situation**: verifying a UI change from a `git worktree` (e.g. `.claude/worktrees/<name>`), which
  starts with no `node_modules`.
- **Doesn't work**: symlinking the main checkout's `node_modules` (root and/or `apps/desktop`) into the
  worktree. The workspace links inside it point `@lobechat/*` at the MAIN checkout's `packages/`, which
  sits on a different branch — the Electron main build then dies with
  `[MISSING_EXPORT] "X" is not exported by "../../packages/<pkg>/src/..."`. Renderer source resolves from
  the worktree while packages resolve from the main repo, so the two disagree.
- **Works**: run `pnpm install` at the worktree root AND `cd apps/desktop && pnpm install` (standalone,
  not in the workspace). \~5 min total, mostly hardlinked from the store.
- **Also**: a Vite dev server left over from an earlier failed `electron-dev.sh start <id>` is REUSED by
  the retry (`CDP already reachable … Skipping start`) and can keep serving pre-edit module text. If the
  DOM shows markup that contradicts the source, curl the dev server for the file and grep for a token you
  just added (`curl -s 127.0.0.1:<vitePort>/src/path/File.tsx | grep -c myNewSymbol`) before blaming the
  code. `electron-dev.sh stop <id>` then start again to get a clean server.

### E9. Electron dev's FIRST cold boot sits on the splash with an empty `#root` for 1–3 minutes

- **Situation**: after `electron-dev.sh start <id>`, `app-probe.sh auth` returns `isSignedIn:false`,
  `#root` has providers but `innerText.length === 0`, and the screenshot is just the LobeHub splash. The
  main log shows `Proactive token refresh failed` / `invalid_grant`.
- **Doesn't work**: concluding the copied login state expired. That refresh error is a red herring — the
  app recovers, and `RENDERER_WAIT_S` (60s) can expire while Vite is still on
  `[optimizer] bundling dependencies`, which ends in `optimized dependencies changed. reloading`.
- **Works**: poll until the DOM actually has content instead of sleeping a fixed amount:
  ```bash
  until [ "$(agent-browser --session s \
    '(function(){return String(document.getElementById("root").innerText.trim().length>50)})()' < port > --cdp < port > eval \
    | tr -d '"')" = "true" ]; do sleep 5; done
  ```
  Also note `zsh does NOT word-split unquoted vars` — `S="--session x --cdp 9226"; agent-browser $S eval`
  fails with `Unknown command`. Inline the flags or use an array.

### E10. ✅ WORKS — stop the main process from yanking the renderer back to its last tab

- **Situation**: driving the SPA to a specific route for a screenshot. `history.pushState` + `popstate`
  lands correctly, then \~15–20s later `location.pathname` snaps back to whatever tab the main process
  has stored (e.g. `/devtools/claude-code`). A hard `location.href` nav is reverted the same way.
- **Cause**: the main process broadcasts `navigate`, and `src/features/DesktopNavigationBridge` obeys it.
- **Works**: HMR-neutralize the bridge for the run, then revert:
  ```tsx
  // src/features/DesktopNavigationBridge/index.tsx — [AGENT-TEST] REMOVE
  useWatchBroadcast('navigate', () => {
    void handleNavigate;
  });
  ```
  `git checkout -- src/features/DesktopNavigationBridge/index.tsx` afterwards; `grep -rn AGENT-TEST src/`
  must come back empty.

### E11. ✅ WORKS — drive the working-directory / git-status ControlBar without the native dir picker

- The picker opens a native dialog, but the same write path is reachable from the store. With no active
  topic, `commit()` persists to `agencyConfig.workingDirByDevice[deviceId]`:
  ```js
  const a = window.__LOBE_STORES.agent(),
    d = window.__LOBE_STORES.device();
  const did = window.__LOBE_STORES.electron().gatewayDeviceInfo.deviceId;
  const entry = { path: '/abs/repo', repoType: 'git' };
  await a.updateAgentConfigById(agentId, {
    agencyConfig: { workingDirByDevice: { [did]: entry } },
  });
  await d.updateDeviceCwd(did, entry, { setDefault: false }); // so the entry exists → sourcePath resolves
  ```
  Create a throwaway agent with `agent().createAgent({ title })` and delete it afterwards with
  `session().removeSession(agentId)` (there is no `deleteAgent` on the agent store) plus
  `device().removeDeviceWorkingDir(did, path)` — otherwise the fixture cwd lingers in the real account.
- **Identify icons precisely**: lucide renders `svg.lucide.lucide-git-fork`. Several git icons live in the
  same bar (the dir picker's `DirIcon` is `git-branch`, the review toggle is `git-compare`), so scope the
  assertion to the trigger: `document.querySelector('[role=button][aria-label="Worktrees"]') svg`, and
  still open the PNG to confirm (Case 1).

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

### E7. curl "502" on localhost with nothing listening = shell proxy env — **only if `NO_PROXY` omits localhost**

- The causal mechanism is real: force a dead host through a proxy
  (`curl --proxy http://127.0.0.1:7890 …`) and you get the proxy's `502`, not
  connection-refused — a "server up but broken" mirage.
- **But it does not reproduce in this environment**, and the note used to state it
  unconditionally. `HTTP_PROXY`/`HTTPS_PROXY` are set here, yet
  `NO_PROXY="localhost, 127.0.0.1, ::1"` exempts exactly the hosts you probe locally.
  Measured against a dead port: with and without `--noproxy '*'`, both give curl exit 7 /
  `code=000` (connection refused). No 502 either way.
- **Works**: `curl --noproxy '*'` is a harmless belt-and-braces habit, but if you actually see
  a 502 from a local port, check `NO_PROXY` before believing this note — the proxy is only in
  the path when localhost is missing from it.

### E14. ✅ WORKS — Electron pool instance boots BLANK because the copied golden login is dead

- **Situation**: `electron-dev.sh start <id>` seeds userData from the golden dev profile,
  but the app renders an empty `#root` (innerText length 0, only the LobeHub watermark) and
  `app-probe.sh auth` returns `isSignedIn:false`. The instance log shows
  `Refresh response missing access_token or refresh_token { error: 'invalid_grant' }`.
- **Cause (measured, not guessed)**: OIDC refresh tokens are single-use. Every prior
  `start <id>` copied the same golden profile and consumed/rotated its refresh token, so the
  copy's token is already dead. A blank shell here is an AUTH failure, not a render bug —
  read the instance log before chasing the SPA.
- **Doesn't work**: pointing `LOBE_GOLDEN_PROFILE` at the packaged app's profile
  (`~/Library/Application Support/LobeHub`) — the pool instance's startup refresh will rotate
  that token too and log the user out of their real desktop app.
- **Works — inject a valid credential the app already owns, no new OAuth grant**:
  the prod lambda accepts any of the user's valid OIDC access tokens via the `Oidc-Auth`
  header, and the CLI keeps one in `~/.lobehub`. Extract it with the CLI's own
  `getValidToken()` (it auto-refreshes), then override the single main-process accessor:
  ```ts
  // apps/desktop/src/main/controllers/RemoteServerConfigCtr.ts — [AGENT-TEST] REMOVE
  async getAccessToken(): Promise<string | null> {
    if (process.env.LOBE_TEST_ACCESS_TOKEN) return process.env.LOBE_TEST_ACCESS_TOKEN;
    ...
  ```
  `export LOBE_TEST_ACCESS_TOKEN=...` before `electron-dev.sh start <id>` (the script forwards
  the shell env). This authenticates BOTH the renderer (BackendProxyProtocolManager injects the
  same token) and any main-process fetch, so the whole app comes up signed in. Revert with
  `git checkout --` + `grep -rn AGENT-TEST` afterwards, and never echo the token.
- **Works — alternative, no source edit, when you can approve a browser prompt**: seed a
  PRISTINE profile so the app takes the signed-out path and renders the real login screen
  instead of hanging:
  ```bash
  mkdir -p /tmp/empty-golden
  LOBE_GOLDEN_PROFILE=/tmp/empty-golden ./electron-dev.sh start <id>
  ```
  Drive onboarding (`开始` → `下一步` ×2 → `登录 LobeHub Cloud`). The device-code flow opens the
  browser and auto-approves against an existing app.lobehub.com session, giving the instance its
  OWN token — so it never rotates the one the user's resident app holds.
- **Why the blank shell has no login button**: the failed refresh leaves `isUserStateInit:false`
  (with `isLoaded:true, user:null`), and the desktop first-frame gate waits on it forever. Every
  route — `/`, `/desktop-onboarding` — renders empty. Reloading, soft-navving, and waiting all
  fail to resolve it, so it reads exactly like a Case-1 blank page.
- **Gotcha**: a worktree installed with `pnpm install --ignore-scripts` has NO electron binary
  (`node_modules/.pnpm/electron@*/node_modules/electron/dist` missing). Fix with
  `cd apps/desktop && pnpm rebuild electron`. Also remember `apps/desktop` and `apps/cli` are
  NOT in the root pnpm workspace — install inside each.
- **Gotcha**: `electron-dev.sh restart <id>` keeps the userData dir, but a device-code session
  did NOT survive it — budget for one more login after any restart (e.g. when a main-process
  change forces one, see E9).

### C5. ✅ WORKS — main-process `logger.info` is invisible unless `DEBUG` is set

- **Situation**: proving WHICH code path the Electron main process took (e.g. hetero
  `ClaudeAgentSdkSession` vs the CLI-spawn `AgentStreamPipeline`). Both produce identical
  user-visible output, so the verdict needs a main-process log line.
- **Doesn't work**: grepping the instance log for the `logger.info('Starting Claude Code SDK
session:')` line. In development `createLogger().info` routes to the `debug` package, which
  prints nothing unless its namespace is enabled (only `console.error` shows up unconditionally).
  Absence of the line is NOT evidence the branch didn't run.
- **Works**: `export DEBUG='controllers:*'` before `electron-dev.sh start <id>`, then
  `grep -oE "controllers:HeterogeneousAgentCtr INFO: [^']*" /tmp/lobe-electron-pool/instance-<id>.log`.
  Don't trust the hetero tracing dir for this — it is gated and the copied golden profile ships
  STALE trace sessions from months earlier that look like a fresh run.

### E15. Main-process code changes need a restart; Vite HMR only covers the renderer

- Adapters under `packages/heterogeneous-agents` run in the **main** process
  (JSONL framing + adapter + `toStreamEvent`). Editing one and reloading the
  renderer verifies nothing — the old adapter is still running.
- Prove which code each process has before trusting a run:
  ```bash
  # renderer: vite serves working-tree src (VITE_BASE + id)
  curl -s --noproxy '*' "http://127.0.0.1:<vitePort>/src/<path>.ts" | grep -c '<marker>'
  # main: rebuilt on start into the desktop dist bundle
  grep -c '<marker>' apps/desktop/dist/main/index.js
  ```

### D13. `record-electron-demo.sh` IS real 30fps capture — but raw avfoundation timestamps are unusable

- **Don't assume the whole skill is 1-2 fps.** `record-gif.sh` and `record-app-screen.sh` are
  CDP-screenshot loops (capped by screenshot latency). `record-electron-demo.sh` is different:
  `ffmpeg -f avfoundation -framerate 30` (see `scripts/record-electron-demo.sh:152-153`) — a
  true OS screen recording, fast enough for sub-second UI transitions.
- **Doesn't work**: a naive `ffmpeg -f avfoundation -framerate 30 -i "1:" -t 14 out.mp4`.
  Measured on one 14s capture: **133332 frames muxed into a 0.13s file at 4.7 Gbit/s, 79 MB**.
  `-ss <n>` then fails with `Output file is empty, nothing was encoded`. Cause not established
  (avfoundation's own PTS appear near-identical); the fix below is empirical.
- **Works**: rebuild the time base — `-use_wallclock_as_timestamps 1` on the input plus
  `-vf fps=20` on the output. Same 14s capture → **14.00s / 136 KB**.
  ```bash
  ffmpeg -y -use_wallclock_as_timestamps 1 -f avfoundation -framerate 30 -capture_cursor 0 \
    -i "1:" -t 14 -vf "fps=20,scale=1200:-2" -c:v libx264 -crf 26 -pix_fmt yuv420p out.mp4
  ```
- **`ffprobe` may be absent even when `ffmpeg` is installed.** Validate with
  `ffmpeg -v error -i out.mp4 -f null -` (silence = decodes fine) and read `Duration` from
  `ffmpeg -i out.mp4 2>&1 | grep Duration`.
- Being an OS capture it is subject to D10 (black frames when the display sleeps): gate with
  `check-screen-recording.sh` and hold `caffeinate -dimsu` for the WHOLE run — re-check right
  before recording if the run has been long, since the display can sleep mid-session.
- **Pick evidence by what you're asserting, not by a rule.** A state transition lasting seconds
  (a loading label flipping) is fine as a 2fps CDP GIF. Reach for 30fps OS capture only when the
  asserted change is sub-second. And when the asserted quantity is a **prop, not a pixel** (e.g.
  `animated = enableStream && transitionMode === 'fadeIn' && isGenerating`, see
  `src/features/Conversation/Messages/useChatMarkdown.tsx:43`), record it with a timestamped
  debug-global (C2) in the same render: failing to film a flicker proves nothing about whether it
  flickers, whereas `0ms:true → 7386ms:false` pins the exact flip.

### D14. A blank page at `about:blank` with a 1280px viewport = the navigation never happened

- **Situation**: driving navigation through `agent-browser-klm.mjs --klm-* ... open <url>` (to
  record interaction atoms). The probe afterwards reports `location.pathname === "blank"`,
  `document.body.innerText.length === 0`, `innerWidth === 1280`, and a screenshot captures an
  empty frame.
- **Not the cause** (verified against `agent-browser 0.26.0`): the KLM wrapper does not blank
  the page — a wrapped `open` navigates identically to a plain one — and `open` does not reset
  the viewport; a viewport set beforehand survives it.
- **What that state actually means**: the `open` exited non-zero without navigating. The
  session still exists, so every later probe succeeds — against the fresh page it was born
  with: `about:blank` at the default 1280×720 viewport. The "reset viewport" is simply a
  viewport that was never set on _that_ page. One confirmed trigger is an unrecognized or
  misplaced global flag (`agent-browser --session S --headless open <url>` →
  `Unknown command: --headless`, exit 1). It is **not** established that this is the only
  trigger: a `--klm-command-timeout-ms` SIGKILL landing mid-navigation, or a daemon restart,
  would leave the same fingerprint. Treat the fingerprint as "the navigation failed", then read
  _why_ off the exit code and stderr rather than assuming a cause.
- **Works**: read the exit code, and read the error. The wrapper used to send the child's stdio
  to `/dev/null`, which is what made a loud `Unknown command: …` look like a silent blank page;
  it now captures the output, echoes it on failure, and records a failed atom as
  `category: "blocked"` with zeroed operators (so phantom work never enters the cost model).

### E12. `next dev` appends a managed block to `AGENTS.md` — once, not every start

- **Situation**: `init-dev-env.sh dev` / `bun run dev` prints `Generated AGENTS.md for AI
agents. Set` `agentRules: false` `in next.config to disable.` and leaves the worktree dirty.
- **Mechanism** (Next.js 16,
  `next/dist/esm/server/lib/{start-server,app-info-log,generate-agent-files}.js`): `next dev`
  calls `ensureAgentRulesForDev(dir)`, gated three ways — `agentRules !== false` in next.config
  (the option is real: `agentRules?: boolean`, default true), `detectAgent()` returning non-null
  (an AI coding agent is in the env), and the managed marker `<!-- BEGIN:nextjs-agent-rules -->`
  being **absent** from `AGENTS.md` / `CLAUDE.md`. It then upserts the block into whichever file
  exists. `upsertFile` compares content and reports `unchanged` without writing, so it is
  idempotent: the block is appended **once**, later starts are no-ops. (Verified twice: calling
  Next's own `writeAgentFiles` against a scratch project returns `updated` then `unchanged`,
  byte-identical; and a real `next dev` printed the line once, after which
  `hasAgentRulesInstalled(repo)` returns true.)
- **Doesn't work — and causes the "every start" illusion**: `git checkout -- AGENTS.md` at
  teardown. That strips the marker, so the very next `next dev` re-appends it. Reverting is what
  makes it look like a per-start rewrite. The block's own text says so: _"Keep this block,
  including in commits. … If it appears as an uncommitted change, that is intentional — commit
  it as-is. Do not remove it to clean up a diff; it will be regenerated."_
- **Works**: commit the block once (Next.js's intent — this repo has not), or opt out with
  `agentRules: false` in `next.config.ts`. Either way it stops recurring. Still check
  `git status` before reporting "worktree clean".

### E13. The shell's `grep` honors `.gitignore` — "not found anywhere" can be a false negative

- **Situation**: proving a symbol/config option does not exist, e.g.
  `grep -rl "agentRules" . --exclude-dir=.git` → one hit (a doc), concluding the option is
  fictional.
- **Doesn't work**: `grep` in this environment is a shell function wrapping
  `ugrep --ignore-files`, which skips `.gitignore`d paths. Searching `.` therefore **silently
  omits `node_modules`**. The option existed in 26 files there.
- **Works**: name the ignored directory explicitly (`grep -rl "agentRules" node_modules`), which
  overrides the ignore, or call `/usr/bin/grep` directly. Before asserting "X exists nowhere",
  re-run the search with an explicit path into the dependency tree.

### E14. Electron `will-attach-webview` params carry NO custom attributes — identity via data-\* never arrives

- **Situation**: a main-process controller needs to know WHICH renderer feature a mounting
  `<webview>` belongs to (e.g. a per-conversation session id), and the renderer put it in a
  custom `data-*` attribute on the element.
- **Doesn't work**: reading `params['data-…']` in `will-attach-webview`. Measured live: params
  only contains the standard set (`instanceId, partition, src, httpreferrer, useragent,
nodeintegration, plugins, disablewebsecurity, allowpopups, preload, …`). The handler silently
  no-ops and — trap — a unit test that mocks params WITH the custom key passes green.
- **Works**: two-channel design. (1) Recognition/hardening keyed off the **`partition`
  attribute** set by the renderer (it IS forwarded); (2) identity bound after mount via an
  explicit IPC — renderer listens for the webview's `dom-ready`, calls
  `attach({ sessionId, webContentsId: el.getWebContentsId() })`, main process
  `webContents.fromId()` + validates the guest's session belongs to the expected partition.

### E16. agent-browser session silently re-targets to a newly created `<webview>` guest

- **Situation**: driving an Electron app over CDP while the app itself spawns a `<webview>`
  (in-app browser). After the guest mounts, `eval` on the SAME session suddenly returns the
  guest page's DOM (`__LOBE_STORES` undefined, app selectors empty) — looks like the app broke.
- **Doesn't work**: assuming a session stays pinned to the app target; also assuming
  `document.querySelectorAll('webview').length === 0` means "no webview" (you may be evaluating
  INSIDE the guest).
- **Works**: `curl -s localhost:<cdp>/json/list` to see targets (`page` = app, `webview` =
  guest), then use **separate session names** per target (`--session app-x` re-picks the `page`
  target; the old session keeps following the guest — handy for driving the embedded page).
  Verify with `get url` (`app://` vs the site URL) before trusting any eval result.

### E17. Dev-mode main-process `logger.warn/debug` is invisible without DEBUG env — probe with console.log

- **Situation**: adding a temporary probe log in Electron main code and watching the dev
  instance log; nothing prints, which reads as "code path never runs".
- **Doesn't work**: `createLogger(ns).warn/debug` in development — it routes to the `debug`
  package, which is silent unless `DEBUG=<ns>` was set when the process started.
- **Works**: temporary probes use `console.log('[AGENT-TEST] …')` (always reaches the instance
  log via stdout); confirm the rebuilt bundle actually contains the probe string
  (`grep "<probe>" apps/desktop/dist/main/index.js`) before interpreting silence.

### D15. Host-page CDP screenshot renders the `<webview>` region BLACK intermittently — guest DOM eval is ground truth

- **Situation**: capturing evidence of an Electron in-app browser (`<webview>` in a sidebar).
  Early `Page.captureScreenshot` shots of the host page included the guest's pixels; minutes
  later the same command on the same target returned the webview region uniformly black
  (byte-identical output across retries), while the app chrome around it rendered fine.
- **Doesn't work**: concluding the embedded page went blank/failed from the host screenshot,
  or retrying the host capture. The guest was healthy the whole time: an `agent-browser`
  session following the webview target (E16) read `document.title` = the expected page and
  full body text.
- **Works**: treat the guest target as the source of truth — eval `title`/`innerText` in the
  webview target for the assertion, and capture the guest's own pixels via a session pinned
  to the `webview` target (`agent-browser screenshot` there) when the embedded page's visual
  matters. Use host-page screenshots only for the app chrome around the webview. Cause of the
  black compositing not established (OOPIF surface not composited into the host capture).

### E18. Cloud-connected desktop routes even `local` agents to the SERVER runtime — force client with `disableGatewayMode`

- **Situation**: verifying a **client-only** builtin tool (`executors: ['client']`) via a real agent turn on the desktop. The agent's `executionTarget` is `local` and the tool-enable gate (`isLocalSystemEnabled` = runtime `local`) passes, so it _looks_ like it will run client-side.
- **Doesn't work**: sending the message as-is. On a cloud-connected desktop, gateway mode is on by default, so the run dispatches to `execServerAgentRuntime` (server/queue path) even for a `local` agent. The client-only tool isn't executable there — the model flails and returns a non-answer (e.g. "browser closed") with no real tool effect. Confirm the path by reading the running op's `type` in `window.__LOBE_STORES.chat().operations` (`execServerAgentRuntime` = server; `executeToolCall` = client).
- **Works**: set the agent's `chatConfig.disableGatewayMode = true` (via `agentStore.updateAgentChatConfigById(id, { disableGatewayMode: true })`) before sending. The run then goes through `executeToolCall` (client runtime); the composer's runtime chip flips to "Local device" and the client executor runs. The gate (`isLocalSystemEnabled`) and the transport (`disableGatewayMode`) are INDEPENDENT — enabling the tool does not force client execution.

### E19. Desktop has no classic session store — reconfigure the existing agent, don't `createSession`

- **Situation**: wanting a throwaway agent for a real-turn test without polluting the user's agent.
- **Doesn't work**: `sessionStore.createSession({...})` — the desktop app doesn't use the classic session store (`sessions` is `[]`, `activeId` is `'inbox'`); agents are a server-backed model in `agentStore.agentMap` keyed by `agt_...`. The created session never becomes the active agent.
- **Works**: back up the active agent's full config (`model`, `provider`, `agencyConfig`, relevant `chatConfig`), reconfigure it in place (`updateAgentConfigById` + `updateAgentChatConfigById`), run the test, then restore every field and clear any injected key-vault entry. Also: `chat.sendMessage` requires `context: { agentId, topicId, isNew }` or it throws `Cannot destructure property 'agentId' of 'context'`. Reads right after an `updateAgent*` can be stale — re-read after \~1.5s to confirm persistence.

### C7. DB-seeded task rows need a `task_`-prefixed id or `resolve()` silently misses them

- **Situation**: seeding a `tasks` row directly in SQL for a router probe, with a
  hand-written id like `tsk_foo`, then calling a task procedure — it 404s
  ("Task not found") even though the row exists and the caller is a member.
- **Doesn't work**: any id not starting with `task_`. `TaskModel.resolve()`
  (`packages/database/src/models/task.ts:220-223`) only treats the input as a row
  id when it starts with `task_`; everything else is upper-cased and looked up as
  a workspace `identifier` (e.g. `T-1`), so `tsk_foo` becomes the identifier
  lookup `TSK_FOO` → null.
- **Works**: use the idGenerator prefix (`task_<suffix>`) for seeded ids, or pass
  the row's `identifier` (`T-<seq>`) to the procedure instead.

### F1. Seeding a shared topic by raw SQL: messages MUST carry `agent_id`, or the share page renders skeletons forever

- **Situation**: fixture-seeding a `/share/t/<id>` page (topics + messages + `topic_shares`
  rows inserted directly). `share.getSharedTopic` returns fine, but the message list stays on
  skeletons; `message.getMessages` with `topicShareId` returns `[]`.
- **Cause**: the client passes `agentId` in the query context and `MessageModel.query` filters
  on it — messages inserted with `agent_id` NULL are silently excluded (no error anywhere).
- **Works**: set `agent_id` on every seeded message row (matching the topic's `agent_id`).
  Probe the endpoint directly before blaming the UI:
  `/trpc/lambda/message.getMessages?input={"json":{"topicId":..,"topicShareId":..,"agentId":..}}`.

### F2. Seeded share topics also need `topics.agent_id`, or the client never fires the message fetch

- **Situation**: same setup as F1, but the failure is one layer earlier — metadata (title)
  renders while `message.getMessages` never even appears in network requests.
- **Doesn't work**: assuming the fetch failed — it was never fired. `useFetchMessages`
  gates on `!!context.agentId && !!context.topicId`
  (`src/store/chat/slices/message/actions/query.ts:268`), and the share page passes
  `agentId: data.agentId ?? ''` — a topic seeded without `agent_id` yields `''` → SWR key
  is null → no request, silent skeleton (a Case-1 lookalike with no error anywhere).
- **Works**: seed an `agents` row and set `topics.agent_id` (and `messages.agent_id`)
  before opening the share page. Verify the fetch actually fired via
  `agent-browser network requests | grep getMessages`, not by waiting on the UI.
