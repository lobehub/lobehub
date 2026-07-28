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
