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
| Verify first-load error            | Clear the relevant cache tier, then reload | A failed revalidation may intentionally keep settled data      |
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
(the skeleton rows). Distinguish the two skeleton states explicitly: the whole panel
collapsing to \~8 text-free rows is the nav-panel fallback, while fixed items present
with only the list area shimmering is ordinary data loading.

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
