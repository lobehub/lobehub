# Browser Frontend Debugging Pitfalls

Use this reference for Electron custom protocols, intermittent rendering, React state inspection,
virtualized lists, and commit attribution.

## Contents

- [Electron and sessions](#electron-and-sessions)
- [React and retained roots](#react-and-retained-roots)
- [Virtualized and optimistic UI](#virtualized-and-optimistic-ui)
- [Evidence integrity](#evidence-integrity)
- [Data and auth boundaries](#data-and-auth-boundaries)
- [Regression attribution](#regression-attribution)
- [Teardown](#teardown)

## Electron and sessions

### Relaunch before attaching

Electron reads `--remote-debugging-port` only during process startup. If the app is already open,
quit it before relaunching with CDP.

### Keep `--cdp` on every command

A named agent-browser session does not guarantee that later commands remain attached to the
Electron target. A command without `--cdp` may silently operate on `about:blank` or a separate
browser. Check `get url` before collecting evidence.

### Do not open custom protocols

`agent-browser open app://renderer/...` may be normalized into a broken HTTP URL such as
`https://app//renderer/...`. Use in-app navigation or `pushstate '/path'` from the existing
`app://renderer` page.

### Prefer conditions over sleeps

Wait for a URL, visible marker, operation state, or DOM condition. Use fixed sleeps only to make a
repro recording human-readable.

## React and retained roots

### The first store may be hidden

Keep-alive routers, Activities, portals, and background tabs can retain multiple component trees.
Several stores can contain the same topic, while another visible tab owns a different store.

For every candidate store, print a structural summary:

- stable context ID;
- raw and derived item counts;
- first/last IDs;
- whether the target ID exists;
- visibility or owning tab when available.

Do not treat the first matching Fiber as authoritative.

### Prefer React DevTools, then use a narrow fallback

Launch with React DevTools support when possible:

```bash
agent-browser open --enable react-devtools http://localhost:3000
agent-browser react tree
agent-browser react inspect <fiberId>
```

For an already-packaged Electron app where DevTools injection is unavailable, a targeted
`agent-browser eval --stdin` can walk `__reactFiber$*` links. Keep the fallback narrow:

1. identify roots from DOM-owned Fibers;
2. de-duplicate Fibers;
3. match stable IDs and expected field shapes;
4. return summaries or `JSON.stringify` snapshots, never live objects or full private content.

Browser DevTools shows live object references. Serialize copied objects immediately:

```javascript
JSON.stringify(value, null, 2);
```

## Virtualized and optimistic UI

### DOM absence is not state absence

A virtualized list can keep an item in `dataSource` while its DOM row is offscreen or recycled.
Compare these boundaries separately:

1. raw messages;
2. parsed/display messages;
3. virtual-list IDs;
4. visible DOM rows.

### Optimistic state can temporarily reverse order

During a send, the UI may append a new user/assistant pair to the current derived list. When the
server response arrives, a deterministic parser can rebuild the list into a different order.
Capture before-send, optimistic, reconciled, and post-scroll states before blaming the renderer.

### Refresh can hide rather than fix

Refresh changes viewport position, retained roots, optimistic buffers, and cache timing. Reinspect
raw and derived state after refresh. A visually normal viewport does not prove the underlying list
is repaired.

## Evidence integrity

### Prove the action happened

Dense chat UIs can expose several nearby icon buttons. A click may open an approval or attachment
menu instead of sending. Confirm the action with a created message ID, request, or operation state
before citing the recording.

### Use evidence that matches the claim

- Static layout or text: screenshot.
- Ordering, flicker, loading, or state transitions: GIF/video plus a final screenshot.
- Server/store/parser boundaries: paired reasoning and execution text.

Keep failed captures for auditability, but do not cite them as proof.

### Bound production mutations

State the maximum number and exact type of writes before testing. Use unique debug labels so test
messages can be identified later. Stop when enough evidence exists.

## Data and auth boundaries

### Use the app's authenticated origin

An Electron `app://` page may authenticate relative application requests but reject an invented
absolute `https://` call because cookies, headers, or protocol handling differ. Reuse the request
shape the app already makes and inspect network traffic before changing origins.

### Project structure, not content

For a message-order bug, IDs, roles, parent links, timestamps, branch metadata, and tool linkage are
usually sufficient. Do not dump prompts, replies, tokens, cookies, or unrelated metadata.

### Pure replay is the strongest boundary

If the exact raw browser input reproduces in a local pure function, Electron, React, Zustand, and
the virtual list are no longer required to explain the bug. Fix and test the pure transformation.

## Regression attribution

### Do not trust a shallow path log blindly

Shallow or grafted repositories can hide intermediate commits. The next visible commit may appear
to add or change a package even when its GitHub PR did not touch that package.

Before naming a first-bad PR:

1. query path commits for the real date range;
2. inspect the commit's actual parent through GitHub;
3. compare the PR file list;
4. run the same fixture on the real parent and merge commit.

### Separate trigger creation from latent bug introduction

A parser bug can exist for weeks and become visible only when a topic acquires a rare sibling or
branch shape. Compare:

- first bad code revision;
- trigger-data creation time;
- suspected PR merge/deployment time.

A recent trigger does not make the newest PR causal.

## Teardown

- Use `agent-browser --session <name> close`; `agent-browser session close <name>` only prints or
  selects a session on some CLI versions.
- Restore the Electron app without CDP.
- Verify the debugging port no longer listens.
- Prefer the platform trash command for temporary directories when deletion policies reject
  recursive removal.
- Preserve screenshots, videos, and reports referenced by acceptance evidence.
