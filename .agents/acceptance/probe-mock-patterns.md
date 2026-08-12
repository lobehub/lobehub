# LobeHub Probe & Mock Guide

This is the project-layer entry point for LobeHub acceptance probes. Read it
together with the agent-testing skill's generic `references/probe-mock-patterns.md`.
Product-independent rules belong upstream; LobeHub routes, stores, services, env
variables, and fixtures belong here.

## Choose the least invasive mechanism

1. **Use a supported command** in `scripts/app-probe.sh` for read-only app state.
2. **Use a public store action or API** when the behavior must execute real product
   logic.
3. **Use an agent-runtime hook** for tool-call mocks. `beforeToolCall` is the
   supported mock boundary; browser HMR patches are not the default for runtime
   tools.
4. **Use a narrowly scoped temporary injection** only when no stable boundary
   exists. Snapshot dirty files first, mark the injection, and prove exact cleanup.
5. **Use the historical field notes** for rare environment or renderer failures.

Never infer a passed UI state from a state probe alone. A visual claim still needs
an opened and inspected screenshot.

## Supported probes

```bash
PROBE=.agents/acceptance/scripts/app-probe.sh

$PROBE ready                      # app root + exposed-store readiness
$PROBE auth                       # renderer auth state
$PROBE server-auth                # authenticated server request (200 vs 401)
$PROBE route                      # current SPA route
$PROBE stores                     # exposed store names
$PROBE ops                        # chat operation summary
$PROBE wait-ops [timeout-seconds] # wait until no operation is running
$PROBE topic                      # active topic + metadata from the paged view
$PROBE goto /settings             # full navigation, then report route
$PROBE errors-install             # begin console.error capture
$PROBE errors                     # read captured console errors
```

Target Electron by default. For a web session:

```bash
AB_TARGET="--session lobehub-dev" $PROBE ready
```

Prefer `server-auth` over `document.cookie`: Better Auth session cookies are
HttpOnly, so an empty `document.cookie` does not establish signed-out state.

## Decision table

| Goal                               | Preferred boundary                         | Notes                                                          |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Confirm app/store mount            | `app-probe.sh ready`                       | Distinguishes an unmounted shell from a ready SPA              |
| Confirm identity                   | `auth` then `server-auth`                  | Renderer state and server session are separate claims          |
| Inspect a running agent turn       | `ops` / `wait-ops`                         | Proves operation state, not which server runtime executed      |
| Read active topic metadata         | `topic`                                    | `topicDataMap` is keyed by `agent_<id>`, not topic id          |
| Render message-attached error UI   | In-memory chat dispatch                    | Safe when the temporary message has a unique id and is deleted |
| Force a tool result                | `beforeToolCall` hook + `event.mock()`     | Local/in-memory hook mode only                                 |
| Force a fetch failure              | Request boundary or narrow HMR injection   | Preserve dirty files byte-for-byte                             |
| Verify first-load error            | Clear the cache tier in the _new_ document | Clearing then reloading does not work — see "Cold SWR cache"   |
| Diagnose Electron target confusion | CDP target list / raw CDP                  | Use a distinct agent-browser session per CDP port              |
| Seed backend fixtures              | Public API first, raw SQL last             | Raw SQL must preserve product id and relation invariants       |

## Project-specific recipes

### Task CLI polling with seeded API-key auth

**Situation:** A local acceptance run is driven through `lh task run` with the
seeded `LOBEHUB_CLI_API_KEY`, and the test needs to observe the asynchronous
repair lifecycle.

**Doesn't work:** `lh task run <id> --follow` switches to `/webapi/*`, which
requires OIDC and rejects API-key auth after the task has already started.
Likewise, `lh acceptance view task:T-N` does not currently resolve a task
identifier to its internal subject id.

**Works:** Start the task without `--follow`, poll with `lh task view T-N`, and
query the aggregate with `lh acceptance view task:<internal-task-id>`. The start
response and task activity expose the operation and topic ids; the Acceptance
bundle exposes the repair round and final rollup.

### Message-attached heterogeneous-agent errors

Inject a temporary assistant message through
`chat().internal_dispatchMessage`, then attach an `AgentRuntimeError`. Supported
guide codes are `auth_required`, `cli_not_found`, `overloaded`, and `rate_limit`;
other values follow the generic error path. Use a unique content marker, verify the
real rendered card, and delete the temporary message afterward.

### Infinite-scroll failure states

When the fixture is too short for the observer to fire, call the real load-more
store action rather than pretending to scroll. This covers the request, catch
path, and rendered retry row; it does not prove the observer gate itself. Use a
scrollable fixture when the observer behavior is the claim.

### Store exposure

`window.__LOBE_STORES.<name>` is a function returning the current state. Call it:

```js
window.__LOBE_STORES.chat();
```

It intentionally does not expose Zustand's `getState` or `setState`. If a test
repeatedly needs mutation, add a dev-only supported action or fixture command
instead of normalizing temporary `setState` HMR patches.

### In-SPA navigation that preserves instrumentation

`app-probe.sh goto` and `location.assign("app://renderer/…")` perform a FULL
reload — any `window.fetch` wrapper or debug global installed via `eval` is
wiped, and its absence reads as "the request never fired". To change route while
keeping instrumentation alive, drive react-router through history:

```js
history.pushState({}, '', '/settings/apikey');
dispatchEvent(new PopStateEvent('popstate'));
```

This remounts the route component (SWR revalidates, list fetch observable by the
wrapper) without recreating the JS context. Leave-and-return with this pattern is
the way to capture a page's first-load request after installing a fetch wrapper.

### Safe mutation-error injection against a real (cloud) account

To exercise a mutation error branch when the app points at the user's real cloud
backend, replace the react-query `mutationFn` body with an immediate
`Promise.reject(...)` via HMR — the mutation then fails before ANY network call,
so clicking a real row (even the user's own data) has zero server effect. Switch
error shapes through a window flag (e.g. plain `Error` vs
`{ data: { code: 'FORBIDDEN' } }`) and prove HMR liveness with a module-level
marker before clicking. Snapshot the dirty file first and restore byte-identically
(cmp), never `git checkout --`.

### Runtime proof

Client and server agent runtimes can produce the same visible result. Prove the
runtime with a server-only artifact: operation row, queue step, or enabled
main/server log namespace. Renderer state alone is not sufficient.

### A new module needs a renderer reload, not HMR, before probing the fix

**Situation:** verifying a source fix in the running Electron dev instance
(`electron-dev.sh`) right after editing.

**Doesn't work:** editing a component and probing a few seconds later. When the
edit adds a **new module** (extracting a hook into its own file), the desktop
Vite renderer can keep serving the previous module graph, so the probe reports
the old behavior. Read as "the fix does not work" — a false negative that looks
exactly like a logic bug in the change under test.

**Works:** force a full renderer navigation (`app-probe.sh goto <route>`) after
adding or moving a module, then re-probe. Confirm the new code is live by a
structural signal (a renamed component in the fiber chain, a new class in the
computed cascade) before concluding anything about behavior.

### Production debug proxy stays on the development loading shell in an isolated browser

**Situation:** verifying a public SPA route with local frontend code against the
production backend through `/_dangerous_local_dev_proxy`.

**Doesn't work:** treating a successful Vite connection or the route's debug ID
as proof that the product page loaded. In a fresh, signed-out automation context,
the proxy can remain on the development loading shell without a useful page error;
its screenshot is blank except for the debug marker.

**Works:** visually reject the loading-shell screenshot, then use the adapter's
isolated local full stack. Seed the test user, ingest a representative public
Acceptance fixture through the local CLI, and capture the same route in separate
authenticated and storage-empty browser contexts. This proves both owner and
shared-viewer rendering without depending on production browser cookies.

### Which entry the dev Electron main window loads is NOT stable — measure it, never assume

**Situation:** verifying anything that lives in `src/spa/entry.desktop.tsx` (bootstrap
identity, adapter registration, boot marks) on an `electron-dev.sh` instance.

**Doesn't work:** assuming any particular entry, in either direction. This has now been
measured with two different results on the same helper:

- Earlier: the main window's entry script was `app://renderer/src/spa/entry.web.tsx`
  while the topicPopup window in the same instance loaded `entry.popup.tsx` — so the
  main window fell through to the root `index.html`. Consequence at the time:
  desktop-entry boot code never executed in dev, and a deletion there passed every dev
  smoke test, which is how one such call was lost for a whole release.
- 2026-08-05, on `feat/home-customize-modal`: the main window loaded
  **`app://renderer/src/spa/entry.desktop.tsx`** — the fall-through did not reproduce.

Mechanism not established in either direction, and no bisect was done, so do not
assume the newer reading is permanent either. Treat the loaded entry as an unknown to
be measured per run — that is the durable rule; the specific value is not.

**Works:** before claiming anything about a desktop entry, read the loaded entry script
and branch on it:

```js
[...document.querySelectorAll('script')].map((s) => s.src).find((s) => s.includes('entry.'));
```

If it is not the entry you are testing, the surface cannot prove your claim — fall back to
a source-order regression test, and say in the report that the runtime path needs a
packaged build (`DESKTOP_RENDERER_STATIC` / `resolveRendererFilePath` maps
`apps/desktop/index.html`, `popup.html`, `overlay.html`).

### Measuring production-bundle startup behavior without packaging the app

**Situation:** a claim depends on the built renderer (chunk splitting, lazy-route
boundaries, startup paint timing), which dev-mode Vite cannot reproduce.

**Doesn't work:** measuring in the dev instance (unbundled modules make lazy vs
eager indistinguishable), or trusting `performance.getEntriesByType('resource')`
to identify what loaded — the `app://` protocol emits no resource-timing entries
at all (0 JS resources on a fully loaded page).

**Works:** build the renderer (`cd apps/desktop && vite build --config
vite.renderer.config.ts`), then launch a pool instance with the static override:

```bash
DESKTOP_RENDERER_STATIC=1 .agents/acceptance/scripts/electron-dev.sh start 1
```

The dev main process serves `apps/desktop/dist/renderer` over `app://renderer/`
with the seeded login. Prove which build is loaded via the modulepreload hashes
in the live DOM, not resource timing:

```js
[...document.querySelectorAll('link[rel=modulepreload]')]
  .map((l) => l.href)
  .find((h) => h.includes('<chunk-under-test>'));
```

Paint metrics survive post-hoc collection: a buffered
`PerformanceObserver({ type: 'largest-contentful-paint', buffered: true })` plus
`performance.getEntriesByType('paint')` read after load give FCP/DCL and the full
LCP-candidate timeline. `restart 1` re-seeds userData, so each restart is a
comparable cold start; `location.reload()` gives low-variance warm samples. For
A/B builds, swap `dist/renderer` directories between restarts — remote-image LCP
entries are network-noisy, so compare text-paint candidates and DCL across ≥5
cold samples per variant before attributing a delta.

### Driving and probing a real Electron popup window

**Situation:** verifying `entry.popup.tsx` behavior (its own HTML shell, no `BootShell`).

**Works:** open the real window from the renderer store, then attach raw CDP to the
popup's own target — the agent-browser daemon holds the main window's target, and one
page target accepts only one websocket:

```bash
agent-browser --cdp 9222 eval '(async () => {
  await window.__LOBE_STORES.global().openTopicInNewWindow("inbox","verify-popup");
  return "requested"; })()'
curl -s http://127.0.0.1:9222/json/list # pick the target whose url contains /popup/
```

Any `(agentId, topicId)` pair works — the popup boots regardless of whether the route
resolves data, which is what makes this usable on a signed-out instance. For overlay
claims, measure rather than eyeball: `getComputedStyle` for `pointer-events` / background
alpha plus `document.elementFromPoint(x, y)` — a 50%-alpha scrim looks like a cosmetic
tint in a screenshot while actually swallowing every click.

### The debug proxy cannot reach a settled app — workspace `packages/*` dynamic imports fail cross-origin

**Situation:** verifying frontend work through `/_dangerous_local_dev_proxy` (production
page + production login + local Vite modules), needing a screenshot of the app after it
has finished loading.

**Doesn't work:** treating the resulting `ErrorBoundary` ("页面暂时不可用") as a defect in
the change under test. The document origin is `https://app.lobehub.com`, and dynamic
`import()` of workspace modules served from `http://localhost:9876` — `packages/builtin-tools/src/register.ts`,
and intermittently `src/routes/**` — fails with `Failed to fetch dynamically imported module`.
The same URLs return **200** to `curl` and to an in-page `fetch()`; only module scripts
fail, because their cross-origin requirements are stricter. So the usual "is it reachable"
probes all say yes while the app still dies.

**Works:** treat this channel as good for boot-phase and pre-settle evidence only, and
prove attribution rather than assuming it — `git stash -u` the whole change, reload the
same proxy URL, and confirm the identical ErrorBoundary appears at HEAD. Report the
settled-state check as blocked with that A/B attached instead of chasing the module
graph. For a genuinely settled authenticated app, use Electron with an injected login
snapshot; the local Vite entry (`http://localhost:9876/`) loads modules correctly but has
no session, so it ends in the same error for a different reason. See also the two
neighbouring entries on this proxy (loading-shell in an isolated context; no seeded
agent-browser session).

### The composer's slash menu needs real key events — `keyboard type` never opens it

**Situation:** driving the chat composer's `/` slash menu (or anything else gated on
a Lexical `KEY_DOWN_COMMAND`) through agent-browser.

**Doesn't work:** `agent-browser keyboard type "/"`. It inserts through CDP
`Input.insertText`, which produces no `keydown` at all — verified by installing a
capturing `document.addEventListener("keydown", …)` and watching it stay empty while
the character lands in the composer. The editor's SlashPlugin keeps `suppressOpen`
true until a keydown with `key.length === 1` resets it, so the text appears and the
menu never does. Reads exactly like "the slash menu is broken", which is worse than
a visible failure because the composer clearly received the input.

**Works:** use `agent-browser press '/'` for the trigger (and `press Backspace` to
clear). `press` goes through `Input.dispatchKeyEvent`, so the keydown reaches
Lexical. `keyboard type` remains fine for bulk text that no plugin is gated on —
type the prose with it, but fire any menu trigger with `press`.

```bash
agent-browser --session "$RS" click '[data-probe=composer]'
agent-browser --session "$RS" press '/'   # menu opens
agent-browser --session "$RS" press Enter # selects the highlighted item
```

Confirm the mechanism rather than assuming a menu is missing:

```bash
agent-browser --session "$RS" eval '(() => { window.__KD=[]; document.addEventListener("keydown", e => window.__KD.push(e.key), true); return "installed"; })()'
```

### Reading a transitioned CSS property immediately after focus/hover

**Situation:** asserting that a `:focus-within` / `:hover` rule reveals a
control.

**Doesn't work:** `getComputedStyle(el).opacity` read in the same tick as the
focus call, or in a separate `agent-browser eval` that races the re-render which
mounts the control. Both return the pre-transition `0` while the rule is in fact
matching.

**Works:** focus and read inside one `eval`, wait past the transition duration,
and assert the untransitioned property too (`width`) plus
`el.matches('<selector>:focus-within')` so a mid-transition value cannot be
mistaken for a non-matching rule.

### Locale regression tests and desktop resource scanning

**Situation:** a locale-copy change needs a focused regression assertion while
the Electron dev renderer imports locale resources from the default resource tree.

**Doesn't work:** placing `*.test.ts` beside files in
`packages/locales/src/default/`. The desktop resource scan can include that module
in the renderer graph, which makes Vite optimize and execute `vitest` in the app.

**Works:** keep the assertion under the consuming feature's test directory and
import the locale resource there. Restart the isolated Electron instance after a
bad scan because the optimized dependency graph can remain poisoned.

### Desktop tab switching is not `activateTab` alone — drive the real tab element

**Situation:** benchmarking or driving a desktop tab switch from an `eval`
payload, using `window.__LOBE_STORES.electron().activateTab(id)`.

**Doesn't work:** on the single-router shell, `activateTab` only writes
`activeTabId`; navigation is a second step performed by the TabBar
(`handleActivate` = `activateTab(id)` + `startTransition(navigate(url))`). Calling
the store action alone leaves `location.pathname` on the previous route, so the
run measures a no-op — visible as a tiny settle time, \~4 DOM mutations, and zero
long tasks, which reads like an impossibly fast surface rather than a broken
probe. The per-tab-router shell does switch content from the store action alone,
so the same payload is a real switch on one build and a no-op on the other:
any A/B built on it is invalid.

**Works:** drive the tab element the user actually clicks, and assert the
navigation happened.

```js
const all = [...document.querySelectorAll('[data-insp-path*="TabBar/TabItem.tsx"]')].filter(
  (e) => e.getBoundingClientRect().width > 100,
);
// two nested nodes per tab match — keep only the outermost
const roots = all
  .filter((e) => !all.some((o) => o !== e && o.contains(e)))
  .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
// roots[i] aligns 1:1 with store tabs[i]; verify roots.length === tabs.length
roots[idx].click();
```

`el.click()` reaches the React `onClick` here (this is not a controlled input, so
the generic D11 trusted-input caveat does not apply). Always record
`location.pathname` before and after and keep a `navigated` flag on every sample —
that flag is what catches a payload that silently stopped switching.

### Clicking an already-active tab is a no-op — a desynced tab can never be re-entered by clicking

**Situation:** a probe adds a tab with `addTab(url)` and then clicks it to enter that route.

**Doesn't work:** `addTab` already activates the new tab, so the later click lands on the _active_ tab
and the shell does nothing. On the single-router shell this can leave `activeTabId` pointing at a tab
whose URL names one topic while `location.pathname` and `chat().activeTopicId` still name another —
after which no amount of clicking recovers it, and every downstream assertion reads the wrong page.
Symptom: the probe's final `location.pathname` is not the tab you clicked, with no error anywhere.

**Works:** after `addTab`, enter the route with a full navigation
(`app-probe.sh goto <url>`) before starting the trials, and assert the three values agree before
measuring:

```js
const st = window.__LOBE_STORES.electron();
const chat = window.__LOBE_STORES.chat();
const tab = (st.tabs || []).find((t) => t.id === st.activeTabId);
// tab.url, location.pathname and chat.activeTopicId must all point at the same topic
```

### Attributing switch work to hidden keep-alive trees — classify on BOTH sides of the action

**Situation:** measuring what a per-tab keep-alive shell costs while a tab is hidden.

**Doesn't work:** collecting the hidden slots (the `display: none` children of the TabHost root) _before_
the switch and classifying every mutation against that list. The switch is precisely what makes the
target tab visible, and that tab was hidden when the list was captured — so the incoming tab's own
render, which is necessary user-visible work, is counted as hidden-tree work. This produced a confident
"\~44% of switch work happens off-screen" that was pure artefact, and it survived review because the
number looked plausible.

**Works:** classify against the intersection — slots hidden **before** the switch that are **still
hidden after** it:

```js
const before = hiddenSlots(); // display:none children of the TabHost root
/* click the tab, observe mutations */
const after = hiddenSlots();
const stillHidden = before.filter((s) => after.includes(s));
```

Measured this way, still-hidden slots produced **0** mutations in 6/6 switches: React
`<Activity mode="hidden">` keeps state, tears down effects, and commits nothing while hidden.

**General rule:** when a measurement classifies work by a property that the measured action itself
changes (visible/hidden, active/inactive, mounted/unmounted), capture the classification on both sides
and use the intersection. Otherwise the action's own effect lands in the wrong bucket.

### Agent Mock playback leaves `pluginState` empty — backfill it before capturing pluginState-driven renders

**Situation:** verifying a builtin-tool Render/Inspector (lobe-agent todos, plans —
anything reading `message.pluginState`) with DevDock → Agent Mock case playback as
the deterministic driver (no LLM).

**Doesn't work:** capturing right after playback. The mock pipeline writes each
tool step's `result` into the tool message `content` only and never sets
`pluginState`, so a Render keyed off `pluginState` mounts empty (expanded rows
show nothing) and inspectors fall to their no-data fallback. Reads as "the new
rendering is broken" when the components are fine. Also note: consecutive todo
tool rows are folded into the latest by the conversation UI, so early-state rows
may never mount.

**Works:** after playback completes, backfill in-memory from each message's own
result JSON, at the layer the Render actually reads:

```js
const c = window.__LOBE_STORES.chat();
const msgs = c.dbMessagesMap['main_<agentId>_<topicId>'];
for (const m of msgs.filter((m) => m.role === 'tool' && m.plugin)) {
  const parsed = JSON.parse(m.content);
  if (parsed?.todos)
    c.internal_dispatchMessage({
      type: 'updatePluginState',
      id: m.id,
      key: 'todos',
      value: parsed.todos,
    });
}
```

To render a payload the case doesn't cover (another builtin tool, a specific
state), payload-swap an already-MOUNTED mock row in place — update BOTH the
assistant's `tools[]` entry (`updateMessageTools`, keyed by `tool_call_id`; this
is what selects the Render component) and the tool message (`updateMessagePlugin`

- `replaceMessagePluginState`). Dispatching brand-new messages at the end of the
  list may never mount. Claude Code builtin payloads use `identifier: 'claude-code'`
  (NOT `lobe-claude-code`) and PascalCase `apiName` (`TodoWrite`). All of this is
  in-memory only — a reload clears it; delete the temp topic at teardown.

### Verifying a builtin-tool Render with no provider key — dispatch a fresh assistant+tool pair

**Situation:** verifying a builtin tool's Render / Streaming component when the local
env has no LLM provider key, so no real model can be made to emit that tool call
(and update/remove-style APIs would need pre-existing entity ids anyway).

**Doesn't work:** waiting for a real run, or reaching for Agent Mock when no case
covers the tool. Note the neighbouring Agent Mock entry warns that "dispatching
brand-new messages at the end of the list may never mount" — that holds for a
long, already-populated mock topic, **not** for an empty conversation.

**Works:** open a conversation with no messages (`/agent/<agentId>`, bucket
`main_<agentId>_new`) and dispatch the pair straight in. The Render is selected from
the **tool message's** `plugin.identifier` + `plugin.apiName`, and its `args` come
from `safeParseJSON(plugin.arguments)` — so those three fields are the whole
contract:

```js
const c = window.__LOBE_STORES.chat();
c.internal_dispatchMessage({
  type: 'createMessage',
  id: aId,
  value: {
    role: 'assistant',
    content: '',
    meta: {},
    tools: [
      { apiName, arguments: argsJson, id: callId, identifier, result_msg_id: tId, type: 'builtin' },
    ],
  },
});
c.internal_dispatchMessage({
  type: 'createMessage',
  id: tId,
  value: {
    role: 'tool',
    content: resultText,
    parentId: aId,
    tool_call_id: callId,
    plugin: { apiName, arguments: argsJson, identifier, type: 'builtin' },
    pluginState,
  },
});
```

Two things that decide what you actually see, both in
`features/Conversation/Messages/AssistantGroup/Tool/`:

- **The row is collapsed unless the manifest says otherwise.** `getRenderDisplayControl`
  defaults to `'collapsed'`, so most tools need a click on the header before the card
  mounts — a screenshot taken right after dispatch shows only the Inspector line.
- **Truncating `arguments` into invalid JSON is how you reach the Streaming component.**
  `isArgumentsStreaming` is literally `JSON.parse(requestArgs)` throwing, and
  `forceShowStreamingRender` then auto-expands the row. Slicing the real args string
  to \~55% is a faithful half-streamed payload and also exercises the card's
  partial-data path.

Toggling the row's first action button flips `showCustomToolRender`, which drops back
to `FallbackArgumentRender` — the same branch an unregistered tool takes, so it is a
faithful "before this change" contrast shot.

### Desktop theme follows the system appearance, not `settings.general.themeMode`

**Situation:** capturing dark-mode evidence for a desktop UI change.

**Doesn't work:** `window.__LOBE_STORES.user().updateGeneralConfig({ themeMode: 'dark' })`.
The setting persists (reading it back returns `dark`, and it survives a restart),
but `document.documentElement.dataset.theme` stays `light` and every token keeps its
light value. Restarting the instance does not apply it either. Treating the stored
setting as proof of the rendered theme yields evidence captured in the wrong theme.

**Works:** assert `document.documentElement.dataset.theme` — never the stored
setting — before capturing any theme-dependent evidence. The renderer tracks the OS
appearance, so switching it means changing the user's macOS system setting, which is
outside the harness's remit: mark the dark case untested and say why, rather than
flipping a device-level preference. Note the setting write is not free — it syncs to
the account and affects other surfaces; restore it (`auto`) at teardown if you set it.

### A node reference captured before a re-render is silently dead — re-query per assertion

**Situation:** asserting several tab-strip interactions (close, pin, switch) in one
`agent-browser eval` payload, reusing the element list collected at the top.

**Doesn't work:** collecting `roots` once and then acting on `roots[0]`, `roots[1]`, …
in sequence. Each action that mutates the tab list re-renders the strip, so every
reference collected earlier now points at a detached node. Dispatching to a detached
node throws nothing and changes nothing — React never sees it — so the assertion reads
as "this interaction does not work". In this catalogue's first occurrence it produced a
confident "middle-click does not close a pinned tab" that was purely an artefact of the
stale reference, and it survived review because the number looked plausible.

**Works:** one assertion per `eval`, re-querying the strip each time. When several must
share a payload, re-query between actions and assert `el.isConnected` before dispatch.
The same applies to any probe whose own action re-renders the tree it is measuring.

### `eval` declarations persist in the page global scope

**Situation:** running several `agent-browser eval` payloads against one renderer.

**Doesn't work:** a bare top-level `const els = …` in a second payload fails with
`SyntaxError: Identifier 'els' has already been declared`, because each `eval`
shares the page's global scope.

**Works:** wrap every payload in an IIFE (`(() => { … })()`), or attach state to a
single namespaced `window.__X` object.

### Shared agent-browser session names can cross-wire concurrent acceptance runs

**Situation:** a Web acceptance run uses the adapter's default `lobehub-dev`
session while another local run is active against a different port.

**Doesn't work:** reusing `lobehub-dev` and trusting the URL printed immediately
after `open`. Another process can steer the same session between commands, so a
later click or screenshot lands on a different acceptance and port.

**Works:** create a run-specific session name and load the seeded auth state
directly:

```bash
RUN_SESSION=visualization-acceptance
agent-browser --session "$RUN_SESSION" \
  --state ~/.lobehub-agent-testing/web-state.json open "$SERVER_URL/acceptance"
```

Then assert `get url` and `app-probe.sh auth` on that exact session before
capturing evidence.

### Agent-browser navigation hangs after an orphaned Next child keeps the port

**Situation:** an isolated full-stack dev launcher exits, but its Next child
continues listening without returning HTTP responses. `agent-browser open`,
`get url`, and even session close can then appear to hang because navigation
never settles.

**Doesn't work:** repeatedly recreating browser sessions or assuming the
browser daemon is the root cause while `curl --max-time` to the target route
also receives zero bytes.

**Works:** inspect the exact listener with `lsof`, confirm its command and
working tree, terminate only that run-owned process tree, then restart through
`init-dev-env.sh dev` and reseed the isolated browser auth. A successful HTTP
probe must precede browser assertions.

### Leftover React Scan instrumentation poisons every screenshot

**Situation:** capturing UI evidence in a dev instance the user (or an earlier
round) had DevTools / the DevDock open on.

**Doesn't work:** deleting the overlay canvas (`html > canvas`) once and
screenshotting. React Scan re-creates it on the next render pass, so a probe that
reports `0 canvases` a few seconds later is only measuring that nothing
re-rendered in that window — the outlines return the moment the app updates.
`localStorage` is also not a reliable read: `react-scan-options.enabled` and
`LOBE_DEV_DOCK_UI.reactScan` can both say `false` while the instrumentation is
live, because it was enabled at runtime and never written back.

**Works:** inject a capture-time style rule instead of removing nodes —
`html > canvas { display: none !important; }` appended to `documentElement`. It
survives re-creation, touches no product code or styles, and disappears on
reload. Remove it at teardown. Disclose it in the report: it suppresses a dev
overlay, which is a capture-time adjustment a reviewer should know about.

### Production-backend web runs have no seeded agent-browser session

**Situation:** verifying frontend-only work against real production data through
`bun run dev:spa`'s `_dangerous_local_dev_proxy` URL.

**Doesn't work:** the adapter's Web evidence path (`agent-browser --session
lobehub-dev` seeded by `setup-auth.sh web-seed`) authenticates against the LOCAL
server. There is no sanctioned way to give that session a production login —
`setup-auth.sh web`'s Chrome-cookie injection is explicitly forbidden against
production.

**Works:** drive the proxy in the user's already-authenticated Chrome (the
`claude-in-chrome` tooling), and compensate for the weaker evidence channel with
DOM measurements (`getBoundingClientRect` / `getComputedStyle`) alongside every
screenshot, plus an independent server-side check through `lh` in a clean env.
Prove the working-tree bundle is actually live first — read back a string that
exists only in the working tree (e.g. a changed placeholder), never assume HMR
applied.

### Counting section instances across the Home rail collapse needs real visibility, not a rect

**Situation:** asserting that a Home section moved between the rail and the main
column rather than being duplicated or lost.

**Doesn't work:** two independent traps, each of which inverts the verdict.

- Filtering candidates by `getBoundingClientRect()` alone. The collapsed rail is
  hidden with `visibility: hidden` after a transition, and a `visibility: hidden`
  subtree **keeps its layout boxes** — so the rail's copy still measures non-zero
  and every folded-in section reads as duplicated. This is the inverse of the
  generic D12 phantom (zero-size decoy); here the stale node is full-size.
- Collecting only leaf elements. The main column's `GroupBlock` renders its
  subtitle as a `<span>` inside the title, so the title element has children,
  while the rail's `RailCard` takes no subtitle and its title _is_ a leaf. A
  leaf-only walk therefore finds a section in the rail and "loses" it in the main
  column — reading exactly like the fold-in never happened.

**Works:** match on the element's own direct text nodes and gate on
`el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })`, then sort
by viewport `y`:

```js
const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
if (!label.test(own)) continue;
if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
```

Assert both columns in the same pass — a claim about _moving_ is only settled by
observing the source column go empty and the destination fill in one snapshot.

### A worktree Electron run leaves a second `@types/react` that fails the worktree type-check

**Situation:** running the Electron surface from a git worktree, which requires
the `apps/desktop` standalone install (adapter §1), then running `bun run check --type`.

**Doesn't work:** treating the resulting type errors as the branch's own. The
desktop install brings its own `@types/react` (e.g. `19.2.18`) alongside the
root's (`19.2.13`), and the two identities collide on every `lucide-react` icon
`ref`, producing a cluster of "Two different types with this name exist, but they
are unrelated" errors in files the branch never touched.

**Works:** intersect the erroring files with the branch's changed-file list before
drawing any conclusion, and confirm causality by A/B — moving
`apps/desktop/node_modules` aside makes the cluster vanish. At teardown, remove
`apps/desktop/node_modules` and re-run the root `pnpm install` to restore a clean
`✓ types clean` baseline. **Do not run the A/B while the instance is live** — the
Electron binary runs out of that directory, so parking it kills the instance;
capture all UI evidence first.

### Managed command runners can reap `electron-dev.sh start` children after the helper returns

**Situation:** `electron-dev.sh start` (legacy and pool forms) reports that CDP
and the renderer are ready, but the CDP port closes immediately after the helper
command returns. The Electron log contains a normal renderer mount and no crash;
changing from the saved login snapshot to the fresh golden profile does not alter
the exit. The cause is not established.

**Doesn't work:** retrying the helper with another pool id or changing the auth
seed. Both instances become interactive during the helper's readiness loop and
are gone before the next command can connect.

**Works:** use the documented multi-instance Model B command in a long-lived PTY
with the same isolated userData, Vite port, IPC id, and CDP port:

```bash
LOBE_DESKTOP_VITE_PORT=5175 \
  LOBE_DESKTOP_USER_DATA_DIR=/tmp/lobe-electron-pool/ud-2 \
  LOBE_IPC_ID=lobehub-desktop-dev-2 \
  pnpm -C apps/desktop dev -- --remote-debugging-port=9224
```

Keep that command session open for the run. Confirm the CDP endpoint, project
process path, `app-probe.sh ready`, renderer auth, server auth, and a raw-CDP
screenshot before collecting evidence.

### `acceptance run ingest` is creative — re-running it to re-read its output mints a duplicate round

**Situation:** after a successful ingest, wanting to re-check a field from its JSON
output (evidence count, acceptanceId).

**Doesn't work:** running the same `ingest` command again "just to see the output".
Every invocation creates a new immutable round on the acceptance — the re-run
publishes a byte-identical duplicate round that reviewers then see twice.

**Works:** re-read state with the read-only commands — `acceptance run list`,
`acceptance run get <runId>`, `acceptance view <id> --json`. If a duplicate was
minted by mistake, `acceptance run delete <runId> --yes` (newest timestamp = the
accident) restores the round history; this is data correction of an operator
error, distinct from the forbidden overwrite-a-real-round.

### A backgrounded `init-dev-env.sh dev` looks dead while the server is alive on a dynamic port

**Situation:** starting the dev server from a harness-managed background command in a
worktree, then waiting for readiness.

**Doesn't work:** trusting the background task's captured output (it can stay 0 bytes
while the detached process tree lives on), or polling the default port. Worktrees
allocate dynamic ports, so probing `localhost:3010` waits forever while the server is
already up elsewhere; a retry then fails with "an owned dev server is already running".

**Works:** treat `.records/runtime/` as the source of truth — it records `PID`,
`SERVER_PORT` and `SPA_PORT` for the owned instance. Read the port from there and poll
that. For a long-lived start prefer a detached `screen -dmS <name> … >> .records/logs/x.log`
so the log lands in a stable file; `stop-dev` still stops the recorded PID tree either way.

### Cold SWR cache: clearing then reloading is undone by the outgoing page

**Situation:** forcing a first-load / skeleton state for anything backed by the
tiered SWR cache (`recent:*`, `topic:*`, `message:*`, …).

**Doesn't work:** clearing `localStorage['lobechat-swr-cache:<scope>']` (and the
`lobehub-local-data` IndexedDB) in the current document, then reloading. The cache
provider registers `flushAll()` on `visibilitychange` and `pagehide`, so the reload
itself makes the outgoing page write its in-memory cache straight back. The next
document hydrates from a repopulated tier and renders settled data — which reads as
"the loading state never happens" and can be mistaken for a product bug.

```
1. before clear      : true
2. right after clear : false
3. after reload      : true   <- the outgoing page re-flushed on pagehide
```

**Works:** clear at document start in the NEW document, before the provider
hydrates:

```js
Page.addScriptToEvaluateOnNewDocument({
  source: `Object.keys(localStorage).filter(k=>k.startsWith('lobechat-swr-cache'))
             .forEach(k=>localStorage.removeItem(k));
           indexedDB.deleteDatabase('lobehub-local-data');`,
});
```

Assert the clear actually ran in the new document (set a flag in that script and
read it back) rather than trusting the removal. Pair it with a warm control run: if
the warm run renders data while the request is held paused and the cold run shows
the skeleton, the cache tier is proven to be what the render reads.

### `app-probe.sh goto /` cannot reach the desktop Home route — seed the tab first

**Situation:** driving the Electron shell to the Home route (`/`) to check the nav
panel there.

**Doesn't work:** `app-probe.sh goto /` prints `"/"` but the renderer stays on the
previous route. `goto` is a full reload, and the desktop shell restores the active
tab's persisted url on boot — every non-root route survives that restore, so `goto`
appears to work for `/tasks`, `/agents`, `/settings` and silently fails only for
`/`. The follow-up probe then describes the old page with no error anywhere.

**Works:** create and activate a Home tab first, then navigate:

```js
window.__LOBE_STORES.electron().addTab('/'); // addTab also activates it
```

```bash
.agents/acceptance/scripts/app-probe.sh goto /
```

Assert `location.pathname` after the reload rather than trusting `goto`'s echo.

### Anchor nav-panel assertions on `#nav-panel-drawer`, not a `data-insp-path` match

**Situation:** asserting what the left nav panel renders on a given route.

**Doesn't work:** `document.querySelector('[data-insp-path*="NavPanelDraggable"]')`.
It resolves during a settled render but returns `null` in the seconds after a full
reload, and the usual `|| document.body` fallback then reads
`document.body.innerText === ''` (generic C4) — which looks exactly like an empty
panel and turns a normal loading window into a false regression.

**Works:** the panel is the `<aside>` sibling of the stable drawer anchor:

```js
const drawer = document.getElementById('nav-panel-drawer');
const aside = drawer && [...drawer.parentElement.children].find((c) => c.tagName === 'ASIDE');
```

Then assert on `aside.innerText` line count plus a count of text-free rounded boxes
(the skeleton rows). Distinguish the two skeleton states explicitly: a text-free panel
carrying `[data-testid="nav-sidebar-skeleton"]` is the nav-panel fallback, while fixed
items present with only the list area shimmering is ordinary data loading. Do NOT
identify the fallback by a row count — it is shaped per navKey now
(`NAV_SKELETON_SHAPES`), so memory/discover render header plus a nav list and no body
at all, while settings renders a search box plus four accordion groups.

### Park a route's lazy chunk to hold its pending sidebar on screen

**Situation:** verifying what a route's `NavPanel` fallback (or any `dynamicElement`
Suspense fallback) actually renders. The pending state lasts a few hundred ms, so no
screenshot or `agent-browser eval` catches it.

**Doesn't work:** network throttling, or adding a debug flag that force-renders the
fallback. Throttling does not bound the module fetch predictably, and a force-render
flag proves the component renders, not that the product path reaches it.

**Works:** raw CDP `Fetch.enable` intercepts `app://renderer/...` module requests in
the Electron renderer. Park the route's layout chunk and the portal never registers,
so the fallback stays up indefinitely — measure and screenshot at leisure, then kill
the CDP connection to release the request and measure the settled sidebar in the same
session.

```js
Fetch.enable({ patterns: [{ requestStage: 'Request', urlPattern: '*settings/_layout*' }] });
// on Fetch.requestPaused: keep the requestId, never continueRequest
// [paused] app://renderer/src/routes/(main)/settings/_layout/index.tsx?t=1785957215039
```

Two traps. The pattern must name the **layout** chunk only: a broad `*settings*`
also parks `store/user/slices/settings/*` and the router's own `routeMeta`, which
stalls boot instead of the route. And the layout module is not always under the path
you guess — the agent sidebar registers from `(main)/agent/_layout`, not
`(main)/agent/(chat)/_layout`; when the measurement comes back `mode: real`, the
pattern missed, it is not a product finding.

Drive the navigation with `app-probe.sh goto <route>` (a full reload, so the module
is re-requested and re-parked).

### Boot-phase UI cannot be observed by CDP polling — sample in-page, and mirror the timer

**Situation:** asserting whether a transient boot-phase surface (a splash, a skeleton,
a first-paint gate) appears between React's first commit and the app painting.

**Doesn't work:** polling `Runtime.evaluate` from a CDP driver, even at a 50ms step.
The desktop renderer's boot spends multi-second stretches in a single synchronous
task, and every `Runtime.evaluate` queues behind it — the driver observes the state
before the window and again after it, and reports the phase "never happened". CPU
throttling makes it worse: it stretches the blocking task and the probe equally.

**Works:** inject a pure observer with `Page.addScriptToEvaluateOnNewDocument` and
sample from inside the page. Note `document.documentElement` does not exist yet in an
on-new-document script, so a `MutationObserver` cannot be attached there — use
`setInterval(check, 8)`. Record the largest gap between consecutive ticks: that gap
is the main thread's longest blocking task, and a boot window with no intermediate
sample is a blocked window, not a missing state.

When the behavior under test is time-thresholded, also **mirror the product's own
timer**: at the moment the observer first sees `#root` gain a child, schedule the same
`setTimeout(…, N)` the component uses and record when it actually fires. On a blocked
main thread it fires far later than `N` — which is the difference between "the
threshold logic is wrong" and "the threshold never had a chance to run", and no
screenshot can tell those apart.

**When the driver has no CDP (claude-in-chrome, the debug proxy), deliver the same
sampler through Vite instead**: a temporary `[AGENT-TEST]` block at the top of
`src/spa/entry.{web,desktop}.tsx` runs at bundle-eval — early enough for every
post-React phase — and needs no `Page.addScriptToEvaluateOnNewDocument`. Two things
to get right in the phase predicate: scope any `[role="status"][aria-label="Loading"]`
check with `.closest('#loading-screen')` so the **static HTML shell's own logo** is not
counted as the React `BrandTextLoading` (they share the same role/label, and conflating
them turns a clean boot into a false "the logo flashed"); and record the max gap between
consecutive ticks — LobeHub's boot routinely shows a single 0.6–1.1s blocking task, so a
phase with no sample inside it is a blocked window, not a missing state.

### A global `indexedDB.open` stall holds the boot on web but kills the Electron renderer

**Situation:** needing to freeze the boot at a pre-app phase long enough to capture it,
by keeping the SWR cache hydration from ever completing.

**Doesn't work on desktop:** replacing `indexedDB.open` with a never-settling stub
breaks the Electron renderer outright — the local database adapter registered in
`entry.desktop.tsx` needs IndexedDB, so the entry dies before React renders and the
HTML loading screen stays up forever. The symptom reads as "the phase under test never
appears", i.e. exactly like the product defect you were looking for.

**Works:** use the stall only on the web entry, where it holds `CacheHydrationGate`
for its full `HYDRATION_TIMEOUT` (about 8s) — ample for a screenshot plus
`getBoundingClientRect` / `getComputedStyle` measurements over the same CDP
connection. For desktop, do not stall storage: observe the natural boot with the
in-page sampler above. Either way, disarm with
`Page.removeScriptToEvaluateOnNewDocument` and reload before capturing the settled
state, or the comparison shot is taken against a still-crippled runtime.

### The desktop instance pins a previous run's server port, and its saved OAuth login expires

**Situation:** starting an Electron dev instance for a surface that needs the local
backend (any tRPC-backed panel), in a fresh worktree.

**Doesn't work:** starting the dev server on the port `init-dev-env.sh` allocates
for this worktree and assuming the app will follow. The desktop app is a thin
client — `BackendProxyProtocolManager` proxies `app://renderer/trpc/*` to whatever
`dataSyncConfig.remoteServerUrl` the seeded login snapshot carries, which is the
port an _earlier_ run allocated. The mismatch surfaces as `app-probe.sh server-auth`
returning **502** (proxy reached nothing), not as an auth error. And once the port
matches, the snapshot's OAuth tokens are usually expired anyway — the app shows
「登录已过期」 and `server-auth` returns **401**, while `auth` still reports
`isSignedIn: true` from renderer state alone.

**Works:** read the app's own target first, then start the server on that port:

```bash
agent-browser --cdp 9222 eval '(() => JSON.stringify(window.__LOBE_STORES.electron().dataSyncConfig))()'
# → {"storageMode":"selfHost","remoteServerUrl":"http://localhost:3111","active":true}
SERVER_PORT=3111 .agents/acceptance/scripts/init-dev-env.sh dev-next
```

For the expired login, do **not** drive the OAuth flow. The proxy forwards the
Electron session's cookies alongside its `Oidc-Auth` header, and the server accepts
a better-auth session cookie — so mint one for the seeded user and inject it over
raw CDP:

```bash
curl -c cookie.jar -H 'Content-Type: application/json' -X POST \
  "$SERVER_URL/api/auth/sign-in/email" \
  --data '{"callbackURL":"/","email":"agent-testing@lobehub.com","password":"TestPassword123!"}'
# then Network.setCookie better-auth.session_token / better-auth.session_data
# for url http://localhost:<port>, domain localhost, httpOnly, on the renderer target
```

Gate on `app-probe.sh server-auth` returning `{"authenticated":true,"status":200}` —
renderer `isSignedIn` alone never proves the server accepted anything.

### `agent.updateAgentConfig` silently drops `agencyConfig.heterogeneousProvider`

**Situation:** turning a test agent into a CLI-agent shape (Claude Code / Codex) so
the heterogeneous chat input and its quota badges render.

**Doesn't work:** `updateAgentConfigById(id, { agencyConfig: { heterogeneousProvider:
{ type: 'claude-code', command: 'claude' } } })`. The store's optimistic write makes
it look applied — reading `agentMap[id].agencyConfig` back returns the provider — but
the DB row keeps only the sibling keys (`executionTarget` persists, the provider does
not), so the next full reload drops it and the plain chat input comes back. Reads as
"the agent isn't hetero" with no error anywhere.

**Works:** seed the shape directly (public API first is the rule; this is the
documented exception where the write path does not carry the field):

```bash
docker exec lobehub-agent-testing-postgres psql -U postgres -d postgres -tAc \
  "update agents set agency_config = '{\"executionTarget\":\"local\",\"heterogeneousProvider\":{\"type\":\"claude-code\",\"command\":\"claude\"}}'::jsonb where id='<agentId>';"
```

Then cold-load: a plain reload keeps serving the agent config from the tiered SWR
cache, so the renderer still shows the pre-write value (generic M18). Clear
`lobechat-swr-cache*` + `lobehub-local-data` through
`Page.addScriptToEvaluateOnNewDocument` and reload (see "Cold SWR cache" above),
then assert `agentMap[id].agencyConfig` before drawing any conclusion.

### An unconverged lockfile puts two copies of a dep in the graph — every route using it dies at the ErrorBoundary

**Situation:** after rebasing onto a canary that bumped a shared UI dependency and
running `pnpm install`, every route rendering the rich-text editor (agent profile,
Home composer) fails with
`LexicalComposerContext.useLexicalComposerContext: cannot find a LexicalComposerContext`
and the SPA shows 页面暂时不可用.

**Doesn't work:** reading it as a defect in the change under test, or as a stale
Vite dep cache. Clearing `node_modules/.vite` (both root and `src/`) and a plain
`pnpm install` both leave it broken, because the duplicate is in the resolution,
not the cache.

**Works:** attribute first, then measure the resolution.

1. Attribution is cheap and decisive: load a route the branch definitely does not
   touch that uses the same dependency. If it fails too, the change under test is
   ruled out without checking out the base ref.

2. The mechanism is two physical copies with different peer sets. The root
   declares an exact-ish range while workspace packages declare a loose one, so a
   dependency bump moves only the root:

   ```bash
   readlink node_modules/@lobehub/editor            # -> …editor@4.23.1_…ui@5.27.0
   readlink packages/*/node_modules/@lobehub/editor # -> …editor@4.20.3_…ui@5.20.2
   ```

   A React context is module-scoped, so two copies means the provider and the
   consumer read different context objects — the symptom is always "cannot find
   the context", never a version error.

3. `pnpm dedupe` converges them; clear the Vite dep caches and restart afterwards.

**`pnpm-lock.yaml` is gitignored in this repo (`.gitignore`), so this divergence is
always LOCAL install state — never something canary committed and never something to
open a PR about.** A loose workspace range (`^4`) stays satisfied by the old version
across incremental installs, so the drift accumulates silently in a long-lived
checkout and appears right after a rebase that bumps the root range. Do not report it
as a defect of the branch or of the base ref; note it as an environment finding and
move on. Back up the lockfile before `dedupe` anyway — it is the only copy.

### A fresh worktree installed with `--ignore-scripts` returns 500 on every `/trpc/lambda/*`

**Situation:** bootstrapping a new git worktree for a run — `pnpm install` at the root,
then `init-dev-env.sh dev`.

**Doesn't work:** `pnpm install --ignore-scripts`. The server starts and serves the SPA
normally, but Turbopack cannot instantiate `@icons-pack/react-simple-icons` (reached
through `packages/const/src/composio.ts` → `packages/database/src/schemas/*`), so every
`/trpc/lambda/*` route returns **500** while the page itself looks healthy. The CLI
surfaces this only as `Unable to transform response from server`, which reads as an auth
or API-key problem and sends you to `setup-auth.sh` instead of to the install. The Next
log holds the real cause (`module factory is not available`), and its own suggested fix
— clear the browser cache / service worker — is misleading here.

**Works:** install without `--ignore-scripts`, and clear the stale Turbopack cache
because the broken module graph is persisted:

```bash
.agents/acceptance/scripts/init-dev-env.sh stop-dev
rm -rf .next && pnpm install # no --ignore-scripts
.agents/acceptance/scripts/init-dev-env.sh dev
```

Gate on a real authenticated TRPC call rather than on the page rendering: a 200 from
`$SERVER_URL/` proves nothing about the lambda routes. Remember `apps/cli` and
`apps/desktop` are standalone installs (PROJECT.md §1), so each also needs its own
`pnpm install` in a fresh worktree.

### The dev Electron instance may be a thin client on PRODUCTION — read `dataSyncConfig` before any write

**Situation:** starting `electron-dev.sh` to verify a frontend change, then driving flows that
create or mutate product objects (labels, groups, agents, forwarded topics, saved edits).

**Doesn't work:** assuming the instance talks to a local backend because the run also started one.
The seeded login snapshot carries its own target, and `{"storageMode":"cloud","active":true}` means
the renderer runs your working-tree code while every request goes to `app.lobehub.com` with the
user's real account. `app-probe.sh server-auth` returns 200, which reads as "the local stack is
wired up" and encourages exactly the writes that then land in production. The local dev server the
run started sits unused.

**Works:** read the target first and let it decide the test's write budget.

```bash
agent-browser --cdp 9222 eval '(() => JSON.stringify(window.__LOBE_STORES.electron().dataSyncConfig))()'
# {"storageMode":"cloud","active":true}   -> production account; keep the run read-only
# {"storageMode":"selfHost","remoteServerUrl":"http://localhost:3111", ...} -> local backend
```

On `cloud`, verify open / render / close only, treat every submit as a user-owned decision, and
prove afterwards that nothing was written (re-read the relevant store count). Note this also makes
the whole local-server bring-up unnecessary — check the target before spending minutes on it.

### Asserting a modal's exit window: `data-ending-style` is never set, and `record-gif.sh` is far too slow

**Situation:** proving what a base-ui modal does during its \~120ms exit — typically that the body
stays mounted while the panel fades, rather than blanking at the start of the animation.

**Doesn't work:** three separate traps.

- Gating on `panel.hasAttribute("data-ending-style")`. `base-ui/Modal/style.mjs` does carry a
  `[data-ending-style]` rule, but the imperative host animates through motion/react, so the
  attribute stays absent for the whole exit. Filtering samples on it yields an empty set and reads
  as "the exit never happened".
- Polling the state from the driver. A `Runtime.evaluate` round trip is the same order of magnitude
  as the window itself, so the driver only ever observes before and after.
- `scripts/record-gif.sh`. Its own header caps effective rate at 1–2 fps; a 120ms window gets at
  most one frame.

**Works:** sample inside the page and capture frames from the compositor.

```js
// exit-window signal = opacity decay on popupInner ([role=dialog] > :first-child)
const tick = () =>
  samples.push({
    t: performance.now() - t0,
    connected: panel.isConnected,
    opacity: getComputedStyle(panel).opacity,
    panelH: panel.getBoundingClientRect().height,
    contentKids: content.children.length,
    contentTextLen: content.innerText.length,
  });
setInterval(tick, 8);
```

A body that survives the exit holds `contentTextLen` / `contentKids` constant while opacity decays,
and the panel shrinks only \~1.5% (the `scale(0.98)` exit transform) instead of collapsing to the
56px header. For the visual half, drive raw CDP `Page.startScreencast` (frames land only when the
compositor paints, so they cluster inside the animation — \~9 frames in the 120ms window) and replay
those unmodified frames slowly with ffmpeg. Do not slow the product's own transition: the exit is a
JS animation, so a CSS `transition-duration` override does nothing anyway.

### Day-scoped fixtures must use the browser's measured timezone, not an assumed one

**Situation:** seeding backdated rows (briefs, activity, digests) whose UI grouping is
by the viewer's _local calendar day_ (`dayjs().startOf('day')` on the client).

**Doesn't work:** computing the day boundaries from an assumed timezone (the user's
usual locale, the server tz, or the shell's). On this harness the agent-browser
Chromium reports `America/Los_Angeles`, so a "today 14:00 CST" timestamp lands on the
browser's _yesterday_ — the day view renders empty and reads exactly like the
feature not fetching, while the server endpoint returns the rows when probed with
the "correct" (assumed-tz) window.

**Works:** before seeding, read the tz the grouping actually uses —
`agent-browser eval 'Intl.DateTimeFormat().resolvedOptions().timeZone'` — and derive
every `[startAt, endAt)` from that. When a day view comes back empty, diff the
client's real request window (fetch wrapper on the batch URL) against the seeded
timestamps before suspecting the query.

### An `ActionIcon` is not a `<button>` — select it by its lucide class, click through agent-browser

**Situation:** driving an icon-only affordance inside a popover or panel (`ActionIcon`
from `@lobehub/ui`: refresh, calendar, more, …).

**Doesn't work:** three separate near-misses, each of which reads as "the affordance
does not exist" rather than as a driving error:

- `pop.querySelectorAll('button')` misses it. `ActionIcon` renders a `div`/`span`
  wrapper (`class="lobe-flex …"` around `span.anticon`), so a button-only sweep of a
  popover reports zero controls and invites the wrong conclusion that the entry was
  never rendered.
- `el.click()` on that wrapper `div` resolves and returns, but no handler runs — the
  React `onClick` sits on an inner node, so the tab-clicking recipe above does not
  transfer to icon buttons.
- `agent-browser click --x <n> --y <n>` is not a thing; `click` only takes a CSS
  selector, XPath, or an `@eN` snapshot ref, and coordinates fail with the generic
  `Element not found`, which reads as a missing element rather than a bad invocation.

**Works:** find the icon by its lucide class, tag it, and let agent-browser do the
real click:

```bash
agent-browser --cdp 9222 eval '(() => {
  const pop = [...document.querySelectorAll("[role=dialog]")].pop();
  pop.querySelector("svg.lucide-calendar-days").setAttribute("data-qc", "entry");
  return "tagged";
})()'
agent-browser --cdp 9222 click "[data-qc=entry]"
```

Enumerate candidates with `pop.querySelectorAll("button,[role=button],span[role]")`
and read each node's `svg` class when the icon's identity is unknown. Two follow-ons
worth knowing: a stray click on a tagged text node can dismiss the popover (re-open
and re-tag rather than assuming the control vanished), and a `Tooltip`-wrapped cell
needs a real pointer move (`Input.dispatchMouseEvent` over several coordinates, or a
dispatched `pointerover`+`mouseover` pair) before its content mounts.

### A pool instance seeded from the login snapshot can boot signed out — `safeStorage` cannot decrypt the copied token

**Situation:** `electron-dev.sh start <id>` in a worktree; the helper reports the
renderer ready and the seeded login is present on disk.

**Doesn't work:** trusting `login-status`'s "refresh token PRESENT" as proof the
instance will come up authenticated. The pool's copied userData can fail to decrypt
its access token — `/tmp/lobe-electron-pool/instance-<id>.log` repeats
`Failed to decrypt access token: Error while decrypting the ciphertext provided to
safeStorage.decryptString` — and the app boots signed out (`app-probe.sh auth` →
`isSignedIn: false`) with a near-blank shell that reads like a broken route tree.
Cause not established; re-seeding and restarting the same pool id does not help.

**Works:** fall back to the legacy single instance (`electron-dev.sh start`, no id),
which runs on the golden profile in place and decrypts normally. It boots on the
loading shell once, so reload once before probing (see L-S8). Gate on
`app-probe.sh auth` AND `server-auth`, never on the helper's "Ready" line.

## Detailed references

- [Probe field notes](./references/probe-field-notes.md) — all historical
  LobeHub findings, original identifiers, commands, and failure analysis.
- [Auth](./references/auth.md) — per-surface auth injection and recovery.
- [Dev server](./references/dev-server.md) — local stack and restart behavior.
- [Multi-instance Electron](./references/multi-instance.md) — pool, ports, CDP
  sessions, and user-data isolation.
- [Agent gateway](./references/agent-gateway.md) — closed-loop gateway probes.

## Adding a new learning

- Add a command or option to `app-probe.sh` when the probe is read-only,
  repeatable, and has a stable output contract. Add a smoke test with it.
- Add a concise recipe here when it is a recurring decision or supported
  mechanism.
- Add a field note only for a narrow incident, including Situation / Doesn't
  work / Works and evidence for every mechanism claim.
- Promote product-independent findings to the generic skill layer rather than
  duplicating them here.

### Switching web-session theme for dark-mode evidence needs no UI — next-themes reads `localStorage.theme`

**Situation:** capturing light- and dark-mode evidence in the seeded `agent-browser`
web session (settings UI navigation is slow and the theme control moved between
releases; an earlier round wrongly concluded the web session "cannot switch to
dark").

**Doesn't work:** driving the settings UI to flip appearance, or editing user
settings server-side (the provider is `next-themes` with `defaultTheme="system"` —
the server does not own it).

**Works:** set the next-themes key directly, then reload the target route in the
same session:

```bash
agent-browser --session lobehub-dev eval "localStorage.setItem('theme','dark')"
agent-browser --session lobehub-dev open "$SERVER_URL/<route>" # re-render applies html[data-theme]
```

`'light'` / removal (`localStorage.removeItem('theme')` → back to system) work the
same way. Restore BEFORE stopping the dev server — once the server is down the
document becomes sourceless and `localStorage` access throws SecurityError, so the
override stays behind for the next run. Assert the applied theme via
`document.documentElement.dataset.theme`, not the storage value.

### A reset shell cwd silently retargets git commits at the main repo's checked-out branch

**Situation:** a long worktree-based session where the harness occasionally resets the
shell cwd back to the main repo root (e.g. after a `cd /tmp` in a compound command).

**Doesn't work:** running `git add -A && git commit` (or `bun run check`) without an
explicit `cd` into the worktree. The commands succeed against the MAIN repo — the
commit lands on whatever branch the user has checked out there, staging their
unrelated dirty files, while the intended worktree change stays uncommitted. The
only tell is an unexpected diffstat / parent commit; `push <branch>` then reports
"Everything up-to-date" because the worktree branch ref never moved.

**Works:** in any worktree session, prefix every git/check command with an explicit
`cd <worktree> &&`, and read the commit output's diffstat + `git log -1` parent
before pushing. Recovery for a mistaken main-repo commit: `git reset --mixed HEAD~1`
restores the user's branch and leaves their working tree as it was (verify against
the session-start `gitStatus` snapshot); nothing needs force-pushing because the
wrong-branch push was a no-op.

### Electron dev 的 BackendProxy 指向登录快照里持久化的 server 端口 — 铸会话 + CDP 注入 cookie

**Situation:** worktree 里起 Electron surface 验证纯前端改动，renderer 一切正常但
`app-probe.sh server-auth` 返回 502，用户状态 `isUserStateInit` 一直 false（受它门控的
UI—— 如 Labs 分栏 —— 静默不渲染，store 状态看起来 "设置了但没生效"）。

**Doesn't work:** 把 dev server 起在 3010 或 test-env.sh 解析出的动态端口。桌面主进程的
BackendProxy 目标端口持久化在登录快照的 userData 里（`/tmp/electron-dev.log` 里
`BackendProxy upstream fetch failed ... http://localhost:<port>` 是唯一真相），与当前
ports-file 无关。端口对上后若见 401，是快照 cookie 对本地库已失效 —— 重启 Electron 重种快照
也救不回来。

**Works:** 三步：① 从日志读出 BackendProxy 的目标端口，`PORT=<该端口>` 起 dev server；
② 用 web-seed 同款 curl 铸 better-auth 会话（`POST /api/auth/sign-in/email`，seeded 用户；
从 renderer 内 fetch 会因 app\://origin 被 403，必须 curl）；③ 把 `better-auth.session_data`
/ `better-auth.session_token` 两个 cookie 经 raw CDP `Network.setCookie`（url 填
`http://localhost:<端口>/`）写进 Electron 的 cookie store，`location.reload()` 后
server-auth 200、`isUserStateInit` true。
