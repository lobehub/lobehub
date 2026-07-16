# Probe / Mock Pattern Library — PROJECT layer (LobeHub)

> **PROJECT layer — writable, LobeHub-specific.** Append project learnings here
> during runs. Each item: Situation / Doesn't work / Works, with a `file:line`
> citation for any mechanism claim (if you only saw a symptom, write "cause not
> established" instead of guessing).
>
> The generic, product-independent recipes (framework/tool-level: agent-browser
> and raw-CDP mechanics, SWR cache-masking method, fetch-outcome interception, the
> `git checkout` snapshot rule) live in the installed skill's
> `references/probe-mock-patterns.md` — read-only in this repo, updated by PR to
> `@lobehub/cli`. Read BOTH layers before a run. When an entry here turns out to
> be product-independent, genericize it (drop `__LOBE_STORES`, file paths, route
> names) and PR it upstream.
>
> Entries keep their ORIGINAL ids (A7, C8, D20, E22, …) so the many internal
> cross-references still resolve. A cross-reference to an id NOT in this file
> (`A4`, `B1`, `C2`, `D9`, `D18`, `E13`, "Case 1 rule", …) points at the generic
> layer, where that recipe was promoted — possibly under a renumbered id.

---

## A. Forcing a fetch to FAIL (error-state testing)

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

## C. Probing app / store runtime state

### C0. A picker backed by a list store may need fixture hydration after direct-route entry

- **Situation**: a modal reads candidate entities from a list store, while the test enters a
  detail route directly. The detail route can render from its own entity/config store without
  ever mounting the list fetcher, so the picker correctly renders an empty candidate list even
  though fixture rows exist in the database.
- **Doesn't work**: inserting database rows alone, or refreshing the detail store. Neither
  hydrates a separate list store that has not mounted its fetch hook.
- **Works**: first enter the canonical list/home surface and let its real fetch settle. If the
  fixture deliberately bypasses normal creation and the list API still does not expose it,
  use the existing C1b dev-only `setState` exposer to hydrate the list store with the exact
  fixture shape, then exercise the real picker component and remove the exposer patch after
  capture. Keep the report explicit that fixture hydration was test setup; validate the actual
  mutation and created entity through the database or network boundary.

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

### C8. ✅ An agent-browser session can silently LOSE its seeded cookies — a 401, not `document.cookie`, is the signal

- **Situation**: verifying an owner-only affordance (a link the server renders only for the
  report's author). The page rendered without it, and the bundle came back `isOwner: false`
  even though the row's `userId` matched the seeded user — which reads exactly like a bug in
  the ownership check.
- **Doesn't work**: `document.cookie` as the auth probe. Better Auth's session cookie is
  **httpOnly**, so `document.cookie` is legitimately `[]` on a fully authenticated page —
  `cookieCount: 0` proves nothing either way.
- **Doesn't work**: trusting `setup-auth.sh web-seed`'s success line for the rest of the run.
  It verified the session at `/`; the session can still be empty later (this run's page had
  also drifted to `about:blank` at one point — see D14).
- **Works**: probe the SERVER, not the document — call any authed procedure from the page and
  read the status. `401` = no session reached the server; `200` = you are really signed in.
  ```js
  const r = await fetch(
    base +
      '/trpc/lambda/user.getUserState?input=' +
      encodeURIComponent(JSON.stringify({ json: {} })),
    { credentials: 'include' },
  );
  r.status; // 401 → re-seed; 200 → the session is live
  ```
  Recover with `agent-browser close --all` + `setup-auth.sh web-seed`, then re-open the route.
  After re-seeding, the same bundle returned `isOwner: true` with the owner-only link rendered —
  the code was correct all along.
- **Why it matters**: an auth-scoped assertion (owner-only / permission-gated UI) fails
  IDENTICALLY whether the gate is broken or the session is missing. Always establish that the
  session is live (a 200 from an authed procedure) BEFORE concluding the gate is wrong —
  otherwise you publish a false bug against your own change.

### C9. A component-scoped "consumed" ref is not a one-shot guard once the component can remount

- **Situation**: a persisted store field carries a one-shot request (`{ nonce, url }`) and the
  consuming component guards against re-consumption with a `useRef` holding the last nonce.
- **Why it silently breaks**: the ref dies with the component. Any change that starts remounting
  the consumer (e.g. giving it a `key` that now varies per topic/session) resurrects the guard as
  `undefined`, so a request that is still sitting in _persisted_ state is re-consumed on every
  remount — and, on a fresh boot, once more. The symptom looks nothing like the cause: a page the
  agent had just loaded gets navigated to a URL from days ago.
- **Works**: retire the request in the store the moment it is consumed, so the one-shot is one-shot
  across mounts and restarts. Watch the merge semantics — if the store patches with lodash `merge`,
  clearing with `undefined` is a **no-op** and the field must be set to `null`.
- **Test for it**: assert the field is `null` (not `undefined`) after the consume action; a test that
  only checks "the request was acted on" passes in both the broken and fixed versions.

### C11. Persisted SWR cache serves a STALE agent config after a direct DB write

- **Situation**: seeding `agents.agency_config` or `agents.model` directly in Postgres, then using
  the app to drive an assertion.
- **Doesn't work**: reload or `internal_refreshAgentConfig`; IndexedDB/localStorage can retain the
  previous config and make a fixture issue look like a product regression.
- **Works**: cold-load by clearing browser storage/caches, re-seed auth, reopen, and assert the
  fixture in `__LOBE_STORES.agent().agentMap[id]` before testing downstream behavior.

---

## D. agent-browser / CDP mechanics (LobeHub-specific surfaces)

### D3. offline is `agent-browser set offline on|off`

- `agent-browser set offline on|off` (under `set`, with `viewport`/`geo`/`headers`), not a
  top-level `offline` command. (LobeHub note: offline trips Chrome's document-level interstitial,
  not the app's `AsyncError` — see the generic layer's fetch-fault recipes for forcing a real
  component error.)

### D6. The singleton hover action bar is hard to drive; its icons are `div[role=button]`, NOT `<button>`

- The per-message action bar (`SingletonMessageActionsBar`) is one portal that moves via DOM + a
  freeze/commit `MutationObserver`, so it appears only while hovering and re-hides on the next
  commit tick. Gotchas that wasted a run:
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

### D7. To get a _finished_ hetero (CC/Codex) turn that ENDS on a tool block

- (last child has tools → `getGroupLatestMessageWithoutTools` returns undefined, the
  `!contentId` action-bar path): send a single long tool call (e.g. `用 Bash 工具运行 sleep 20`)
  and, the moment the group's last child is a running tool, call `stopGenerateMessage()` in the
  SAME eval to avoid the race where CC appends a trailing text summary (which would give it a text
  last-block and a defined contentId). Poll-then-stop-atomically:
  ```bash
  agent-browser $S eval '(function(){var c=window.__LOBE_STORES.chat();var t=c.activeTopicId;var a=c.messagesMap["main_"+c.activeAgentId+"_"+t]||[];var g=a.filter(m=>m.role==="assistantGroup").pop();var lc=g&&g.children&&g.children.at(-1);var running=Object.values(c.operations||{}).some(o=>o.status==="running");if(lc&&(lc.tools||[]).length&&running){c.stopGenerateMessage();return "STOPPED";}return "wait";})()'
  ```

### D11. ✅ WORKS — catch a BRIEF blank/transient frame (sub-second) that screencast misses

- Verifying a momentary full-screen blank (e.g. a React subtree unmounting to `null` for
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
- Being an OS capture it is subject to the display-sleep black-frame problem: gate with
  `check-screen-recording.sh` and hold `caffeinate -dimsu` for the WHOLE run — re-check right
  before recording if the run has been long, since the display can sleep mid-session.
- **Pick evidence by what you're asserting, not by a rule.** A state transition lasting seconds
  (a loading label flipping) is fine as a 2fps CDP GIF. Reach for 30fps OS capture only when the
  asserted change is sub-second. And when the asserted quantity is a **prop, not a pixel** (e.g.
  `animated = enableStream && transitionMode === 'fadeIn' && isGenerating`, see
  `src/features/Conversation/Messages/useChatMarkdown.tsx:43`), record it with a timestamped
  debug-global (C2) in the same render: failing to film a flicker proves nothing about whether it
  flickers, whereas `0ms:true → 7386ms:false` pins the exact flip.

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

### D20. ✅ Main-process `WebContentsView` pages are their own CDP page targets — they hijack target selection, AND they are the best pool probe

- **Situation**: verifying an in-app browser whose pages are owned by the MAIN process as
  `WebContentsView`s (not renderer `<webview>` guests — that is E16/D15, a different shape).
- **Doesn't work**: assuming any tool that "just connects to the CDP port" lands on the app.
  Every live page shows up in `/json/list` as its own `type: page` target, so both
  `agent-browser` and `scripts/cdp-screenshot.sh` can silently attach to a _web page the app
  is hosting_ instead of the app itself. Measured: `cdp-screenshot.sh` reported
  `targetUrl: https://example.com/` and wrote that page's pixels while the intended evidence
  was the app window; an `agent-browser get url` on the same port hung.
- **Works — pin the target by URL prefix.** Raw CDP, pick the target whose `url` starts with
  `app://renderer`, and evaluate against that:
  ```js
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === 'page' && t.url.startsWith('app://renderer'));
  new WebSocket(target.webSocketDebuggerUrl); // → Runtime.evaluate
  ```
- **Works — the same property is the cheapest page-pool probe there is.** One live page ==
  one `page` target, so `/json/list` filtered to non-`app://` URLs _is_ the pool's contents.
  Use it to assert per-session isolation (N sessions → N coexisting pages, and a page that
  should have survived an action is still listed) without adding any IPC or store probe:
  ```bash
  curl -s --noproxy '*' http://127.0.0.1:$CDP/json/list \
    | python3 -c "import json,sys; print([t['url'] for t in json.load(sys.stdin) if t['type']=='page'])"
  ```
- **Pixels still need an OS capture.** A `WebContentsView` does not composite into the host
  page's `Page.captureScreenshot`, so app-window evidence that must _show the embedded page_
  has to come from `capture-app-window.sh` (macOS `screencapture -l <windowid>`), which does
  not require bringing the window to the front.

---

## E. Env / ports / dev-server (LobeHub-specific)

### E1. ⚠️ The old `init-dev-env.sh env` clobber note was wrong — do not trust its reasoning

- It claimed `eval "$(init-dev-env.sh env)"` "can clobber `PATH`". It cannot: the `env`
  subcommand prints only the keys in `env_keys()` (`init-dev-env.sh:178-204`), and the string
  `PATH` does not appear anywhere in the script. It also told you to hardcode
  `http://localhost:20874`; `SERVER_PORT` is **randomly allocated per workspace** in
  20000-40000 (falling back to 3010) and persisted to `.records/env/agent-testing-ports.env`,
  so `20874` was one machine's old port (this workspace is on 21912) and it appears nowhere
  else in the repo. **Works**: read the port from that file, or export just the one var —
  `export APP_URL="$(init-dev-env.sh env | sed -n 's/^APP_URL=//p')"`. Whatever broke
  `awk`/`head` in the original run was never diagnosed.

### E2. SPA port is configurable to coexist with another worktree

- Vite binds `SPA_PORT||9876`; Next proxies `VITE_DEV_PORT||9876`. Pass `SPA_PORT=9877` to
  `init-dev-env.sh dev` (it exports `VITE_DEV_PORT=$SPA_PORT`) so both agree and you don't fight
  a worktree already on 9876.

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

### E8b. The standalone `apps/desktop` install BREAKS the root workspace's type resolution — re-run the root install after it

- **Situation**: a worktree set up per E8 (`pnpm install` at the root, then
  `cd apps/desktop && pnpm install`). Everything runs — Electron boots, the renderer serves live
  code — but a full `bun run type-check` that passed BEFORE the desktop install now fails with
  dozens of errors that have nothing to do with the change under test:
  `Module '"@lobechat/types"' has no exported member 'MetaData' | 'HotkeyId' | …` plus
  `Type 'UserHotkeyConfig' is missing the following properties from type 'UserHotkeyConfig'` —
  the same name on both sides, i.e. **two copies of `@lobechat/types` in one program**.
- **Doesn't work**: chasing it as a code defect, or checking the symlink
  (`node_modules/@lobechat/types → ../../packages/types` looks correct) and `packages/types/node_modules`
  (its deps are all present). Both look fine while the program still sees two instances.
- **Cause**: `apps/desktop` is NOT in the root pnpm workspace (see E8). Its standalone install
  re-resolves the `packages/*` links from its own lockfile and rewrites shared package deps under
  `packages/*/node_modules`, leaving the root workspace pointing at a second instance.
- **Works**: run `pnpm install` at the worktree root ONE MORE TIME, after the desktop install
  (\~1.5 min, mostly cached). Type-check goes back to 0 errors and Electron keeps working.
  So the safe order is: root install → desktop install → root install again. And never publish a
  "type-check failed" verdict from a worktree until you've re-run the root install — the failure is
  environmental, and the error text (a type "missing properties from" itself) is the tell.

### E9. Electron dev's FIRST cold boot sits on the splash with an empty `#root` for 1–3 minutes

- **Situation**: after `electron-dev.sh start <id>`, `app-probe.sh auth` returns `isSignedIn:false`,
  `#root` has providers but `innerText.length === 0`, and the screenshot is just the LobeHub splash. The
  main log shows `Proactive token refresh failed` / `invalid_grant`.
- **Doesn't work**: concluding the copied login state expired. That refresh error is a red herring — the
  app recovers, and `RENDERER_WAIT_S` (60s) can expire while Vite is still on
  `[optimizer] bundling dependencies`, which ends in `optimized dependencies changed. reloading`.
- **Works**: poll until the DOM actually has content instead of sleeping a fixed amount:
  ```bash
  until [ "$(agent-browser --session s --cdp $PORT eval \
    '(function(){return String(document.getElementById("root").innerText.trim().length>50)})()' \
    | tr -d '"')" = "true" ]; do sleep 5; done
  ```
  Also note `zsh does NOT word-split unquoted vars` — `S="--session x --cdp 9226"; agent-browser $S eval`
  fails with `Unknown command` (the zsh word-split rule itself was promoted to the generic layer). Inline
  the flags or use an array.

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

### E18. Cloud-connected desktop routes even `local` agents to the SERVER runtime — force client with `disableGatewayMode`

- **Situation**: verifying a **client-only** builtin tool (`executors: ['client']`) via a real agent turn on the desktop. The agent's `executionTarget` is `local` and the tool-enable gate (`isLocalSystemEnabled` = runtime `local`) passes, so it _looks_ like it will run client-side.
- **Doesn't work**: sending the message as-is. On a cloud-connected desktop, gateway mode is on by default, so the run dispatches to `execServerAgentRuntime` (server/queue path) even for a `local` agent. The client-only tool isn't executable there — the model flails and returns a non-answer (e.g. "browser closed") with no real tool effect. Confirm the path by reading the running op's `type` in `window.__LOBE_STORES.chat().operations` (`execServerAgentRuntime` = server; `executeToolCall` = client).
- **Works**: set the agent's `chatConfig.disableGatewayMode = true` (via `agentStore.updateAgentChatConfigById(id, { disableGatewayMode: true })`) before sending. The run then goes through `executeToolCall` (client runtime); the composer's runtime chip flips to "Local device" and the client executor runs. The gate (`isLocalSystemEnabled`) and the transport (`disableGatewayMode`) are INDEPENDENT — enabling the tool does not force client execution.

### E19. Desktop has no classic session store — reconfigure the existing agent, don't `createSession`

- **Situation**: wanting a throwaway agent for a real-turn test without polluting the user's agent.
- **Doesn't work**: `sessionStore.createSession({...})` — the desktop app doesn't use the classic session store (`sessions` is `[]`, `activeId` is `'inbox'`); agents are a server-backed model in `agentStore.agentMap` keyed by `agt_...`. The created session never becomes the active agent.
- **Works**: back up the active agent's full config (`model`, `provider`, `agencyConfig`, relevant `chatConfig`), reconfigure it in place (`updateAgentConfigById` + `updateAgentChatConfigById`), run the test, then restore every field and clear any injected key-vault entry. Also: `chat.sendMessage` requires `context: { agentId, topicId, isNew }` or it throws `Cannot destructure property 'agentId' of 'context'`. Reads right after an `updateAgent*` can be stale — re-read after \~1.5s to confirm persistence.

### E20. Killing the dev server mid-write corrupts `.next/dev` — every route 404s and `/` ↔ `/signin` ping-pong

- **Situation**: after `init-dev-env.sh clean` (or any kill) and a restart, the whole app is broken: `/` 302s to `/signin`, `/signin` 307s back to `/` (`ERR_TOO_MANY_REDIRECTS` in the browser, `redirect count exceeded` in the dev server's own prewarm), and even API routes like `/api/auth/sign-in/email` return the app-router not-found. It looks like an auth/OIDC misconfiguration.
- **Cause**: a corrupt Turbopack build in `.next/dev` — the route manifest is gone, so every path falls through to `GlobalNotFound`, whose redirect collides with the middleware's.
- **Works**: `rm -rf .next` then restart. Diagnose it in one step: if `/signin` does not return 200, the routes are not compiled — stop debugging auth.

### E21. ✅ WORKS — a QStash-protected workflow endpoint can't be curl'd; publish through local QStash to get a signed delivery

- **Situation**: driving a cron-style workflow handler under `/api/workflows/**` (e.g. a dispatcher you want to fire on demand instead of waiting for its schedule).
- **Doesn't work**: `curl -X POST <app>/api/workflows/<...>` → `{"error":"Invalid signature"}` / HTTP 401. The `qstashAuth` middleware verifies the Upstash signature whenever `QSTASH_CURRENT_SIGNING_KEY` is set — and `init-dev-env.sh` exports it, so the local env DOES verify. (Do not "fix" this by unsetting the key: you would then be testing an unauthenticated path that production doesn't have.)
- **Works**: start local QStash (`init-dev-env.sh qstash`) and publish to the endpoint with the QStash client — QStash signs the delivery, so the handler sees exactly the production shape:
  ```ts
  // must live INSIDE the repo (a script under /tmp cannot resolve @upstash/qstash)
  import { Client } from '@upstash/qstash';
  const client = new Client({ baseUrl: process.env.QSTASH_URL!, token: process.env.QSTASH_TOKEN! });
  await client.publishJSON({
    body: { dryRun: false },
    url: `${process.env.APP_URL}/api/workflows/<path>`,
  });
  ```
  Run it with `eval "$(init-dev-env.sh env)" && bunx tsx ./scripts/<probe>.mts`, then read the outcome from **DB side effects**, not the HTTP body — QStash swallows the response. (A claim/lease row, a status transition, or new message rows are all observable; the handler's JSON return is not.)
- **Time-travel a schedule instead of waiting**: for a "runs at T" feature, `UPDATE ... SET metadata = jsonb_set(metadata, '{...,runAt}', '"<past ISO>"')` and then fire the dispatcher. Cheaper and more deterministic than sleeping until the real due time.

### E22. Local dev env has no `JWKS_KEY` — every hetero agent run dies at `signOperationJwt`

- **Situation**: a real Claude Code / Codex run in the local no-`.env` env fails immediately with `Failed to sign operation JWT for hetero agent` (`apps/server/src/services/aiAgent/index.ts`). Nothing in the UI explains it; the topic just fails.
- **Cause**: `signOperationJwt` → `getSigningKey()` → `getJwksKey()` needs the `JWKS_KEY` RSA JWK, and `init-dev-env.sh` does not export one.
- **Works**: the repo ships a generator — `JWKS_KEY="$(node scripts/generate-oidc-jwk.mjs)" ./.agents/verify/scripts/init-dev-env.sh dev`. Must be present at dev-server **start** (it is read from `process.env`), so a running server has to be restarted.
- **Note the failure is downstream-honest**: with `JWKS_KEY` set, the run proceeds and then fails at the hetero _sandbox_ (`Hetero sandbox spawn failed / unauthorized`) unless the agent has a real Claude Code token. Those are two different walls — don't read the second as the first.

### E25. Electron `will-attach-webview` params carry NO custom attributes — identity via data-\* never arrives

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

### E27. ✅ `source`-ing an unquoted JSON env var silently corrupts it (JWKS\_KEY → gateway auth\_failed)

- **Situation**: writing an env file for the local gateway loop with
  `JWKS_KEY={"keys":[{"kty":"RSA",...}]}` on one line, then `set -a; source that-file`.
- **Doesn't work**: the shell strips every double quote from an unquoted assignment, so the process
  receives `{keys:[{kty:RSA,...}]}` — invalid JSON. `getJwksKey()` (`packages/trpc/src/utils/internalJwt.ts:13-20`)
  throws on `JSON.parse`, `signUserJWT` throws, and the server hands the client an **empty** gateway
  token. The browser sends `{"token":"","type":"auth"}` and the gateway answers `auth_failed`.
- **What makes it genuinely deceptive**: `local-gateway-setup.sh` and `local-gateway-probe.mjs` read
  `JWKS_KEY` out of the file with a **regex**, not by sourcing it — so both are unaffected. The probe
  cheerfully prints `✅ auth_success` while the real browser path is broken. A green probe is NOT
  evidence the app's own token works.
- **Works**: single-quote the value in the env file (`export JWKS_KEY='{"keys":[...]}'`) and prove the
  round-trip before starting the server:
  ```bash
  (source env-file && node -e 'JSON.parse(process.env.JWKS_KEY); console.log("ok")')
  ```
  To diagnose an `auth_failed`, hook `ws.send` in the page and read the token the client actually
  sends — an empty string means the SERVER failed to sign, not that the gateway rejected a signature.

### E28. The chat input silently refuses to send when the agent's model is retired

- **Situation**: driving a real turn (store `sendMessage` or type+Enter). The call resolves, no error
  is thrown, `activeTopicId` stays `null`, and no `agent_operations` row appears. Nothing in the dev
  server log — the request is never even issued.
- **Cause**: the composer shows a small inline warning ("当前模型已下线。请选择其他模型后继续使用。")
  and disables send. A model id that was valid a while ago (e.g. `deepseek-chat`) can be retired from
  the model bank while the agent row still points at it.
- **Works**: read the actually-enabled models out of the store before configuring a fixture agent —
  `window.__LOBE_STORES.aiInfra().enabledChatModelList` → `[{id: provider, children: [{id: model}]}]` —
  and pick one from there. Also: a send that "resolves fine but creates no operation" is a UI-gate
  symptom; **screenshot the composer** instead of re-reading your store call.

### E29. Fresh-worktree `seed-user` dies on `Cannot find module 'bcryptjs'` — NODE\_PATH into .pnpm fixes it

- **Situation**: in a fresh git-worktree install, `init-dev-env.sh seed-user`
  (which runs `node <<'NODE'` from the repo root) throws MODULE\_NOT\_FOUND for
  `bcryptjs`, even though `pnpm install` succeeded.
- **Cause not fully established**: `bcryptjs` exists in `node_modules/.pnpm/`
  but is not linked at the repo-root `node_modules` top level in that install
  (`pg` was linked, `bcryptjs` wasn't), so a root-cwd stdin script can't
  resolve it.
- **Works**: prefix the call with
  `NODE_PATH="$PWD/node_modules/.pnpm/bcryptjs@<ver>/node_modules"` (check the
  exact version dir first). CJS stdin scripts honor NODE\_PATH; seeding then
  completes normally.
- Same run also (re)confirmed: `init-dev-env.sh dev` ports are DYNAMIC (e.g.
  next on 33803, vite on 32459) — never hardcode 3010; re-run
  `scripts/test-env.sh` after the server is up, it reads the ports-file. And
  the `os error 35` agent-browser daemon wedge recovers with
  `agent-browser close --all` + re-running `setup-auth.sh web-seed`.

### E30. ✅ "Failed to fetch dynamically imported module" points at the WRONG file — the failure is downstream

- **Situation**: the SPA renders as a Case-1 blank page; console names a dynamic-import route module.
- **Doesn't work**: investigating only the named module. It may return 200 because the actual failure
  is in its transitive import graph; changing `?t=` values are ordinary HMR invalidation.
- **Works**: take and read a screenshot. Vite's HMR overlay contains the real transform/import error.
  After a rebase or pull, refresh dependencies and restart before treating the blank SPA as a code bug.

### E31. Web agent turns run the CLIENT runtime — no `agent_operations` row will appear

- **Situation**: driving a real web turn and polling `agent_operations` for the run.
- **Doesn't work**: waiting for a server operation when the web surface dispatched the client runtime.
- **Works**: use client observables (`messages.model`, thread ids, and chat-store operations) for web;
  use CLI/server execution and `agent_operations` for the server runtime. A change affecting both paths
  needs evidence from both paths.

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

### E7. curl "502" on localhost with nothing listening = shell proxy env — **only if `NO_PROXY` omits localhost**

> (LobeHub-env note; the general proxy-mirage rule was promoted to the generic layer.)

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

### E12. agent-browser daemon serializes commands — `open` queues behind a record-gif loop

> (was tagged D12 in an interleaved section of the old file; LobeHub loading-state recipe.)

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

## F. Direct-SQL fixture seeding (LobeHub schema)

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
