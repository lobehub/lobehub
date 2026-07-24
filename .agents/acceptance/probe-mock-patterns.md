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

### Runtime proof

Client and server agent runtimes can produce the same visible result. Prove the
runtime with a server-only artifact: operation row, queue step, or enabled
main/server log namespace. Renderer state alone is not sufficient.

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
