# Frontend Diagnosis Supplements

Read this only after the mandatory `agent-testing` workflow has selected and
approved an isolated execution surface.

## Contents

- [React and retained roots](#react-and-retained-roots)
- [Virtualized and optimistic state](#virtualized-and-optimistic-state)
- [Cache ownership and remounts](#cache-ownership-and-remounts)
- [Safe fixture replay](#safe-fixture-replay)
- [Regression attribution](#regression-attribution)

## React and retained roots

### The first store may be hidden

Keep-alive routers, Activities, portals, and background tabs can retain multiple
component trees. Several stores can contain the same entity while the visible tab
owns another store.

For every candidate store, compare a structural summary:

- stable context and route ID;
- raw and derived item counts;
- first and last IDs;
- whether the target ID exists;
- visibility or owning tab when available.

Do not treat the first matching Fiber as authoritative. Prefer the project's
state probe or React DevTools. Use targeted Fiber inspection only as a fallback,
and serialize copied values immediately with `JSON.stringify(value, null, 2)`.

## Virtualized and optimistic state

### DOM absence is not state absence

A virtualized list can retain an item in its data source while its DOM row is
offscreen or recycled. Compare raw records, derived records, virtual-list IDs,
and visible rows separately.

### Optimistic state can hide the reconciliation defect

Capture the state immediately before the action, after the optimistic update,
after server reconciliation, and after a remount. A correct optimistic frame
does not prove that the authoritative cache was updated.

### Refresh can hide rather than fix

Refresh changes the React root, viewport, optimistic buffers, in-memory cache, and
revalidation timing. Reinspect the underlying state after refresh; a visually
correct final frame does not explain an earlier stale frame.

## Cache ownership and remounts

Treat each cache boundary as a separate owner:

1. server persistence;
2. network response;
3. SWR or query-client in-memory entry;
4. Zustand or component state;
5. persisted browser cache;
6. remounted consumer state.

For a mutation followed by navigation, record this exact timeline:

1. mutation result;
2. optimistic/local state update;
3. query-cache update or invalidation;
4. persisted-cache write;
5. route unmount;
6. remount hydration;
7. server revalidation.

If a stale item appears only after remount and disappears after revalidation,
compare the mutation's local store update with the query cache under the same
key. A mutation that updates Zustand but leaves SWR unchanged can be overwritten
when the remounted fetch hook hydrates Zustand from the stale SWR entry.

Do not prove this by manually injecting storage into a production client. Seed
the server-side fixture and client cache state inside the approved isolated
environment, then observe the real application lifecycle.

## Safe fixture replay

Project structure rather than private content. IDs, types or roles, parent links,
timestamps, branch metadata, cache keys, and tool linkage are usually sufficient.

When an exact browser input reproduces in a local pure function, Electron, React,
Zustand, and the virtual list are no longer required to explain that boundary.
Fix and test the pure transformation.

## Regression attribution

### Do not trust a shallow path log blindly

Shallow or grafted repositories can hide intermediate commits. Before naming a
first-bad PR:

1. query path commits for the real date range;
2. inspect the commit's real parent;
3. compare the PR file list;
4. run the same fixture on the parent and merge commit.

### Separate trigger creation from latent bug introduction

Compare the first bad code revision, trigger-data creation time, and deployment
time. A recent data event can expose an older latent defect; it does not make the
newest PR causal.
