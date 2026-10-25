# @lobechat/replica

Every list and detail the UI shows is a **replica**: a local copy of server state that paints on the first frame, then converges on the server in the background.

- **First frame from the replica.** The last confirmed value is read from persistent storage before the network answers, so a reload or a revisit never flashes a skeleton.
- **Server confirms quietly.** The head page from the network replaces the replica. Loaded pages, client-only rows and pending writes survive the replace.
- **Writes land immediately.** Optimistic overlays apply right away. A failed write rolls back to the confirmed base plus any other writes still in flight. Optimistic values never reach storage.
- **One entity, every copy.** `linkReplicaEntity` sends a patch or delete to every replica that holds the entity: the list row, the management page and the detail cache.
- **Identity-safe.** Memory and storage are partitioned by scope (user + workspace). On a scope switch the view is cleared before paint, and late results from the previous scope are dropped.

## Layers

| Entry                       | What it owns                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lobechat/replica`         | Core engine, framework-agnostic: resource definition, pure reducer, paging (offset / cursor, forward / backward), entity links, serialized persistence, storage adapters (see [Storage](#storage)). |
| `@lobechat/replica/zustand` | Zustand adapter: binds a resource to one location in a domain store (`recordLens`). Adds a `useSync` hook that schedules fetches through a `ReplicaSyncDriver` (`createSWRDriver` for SWR).         |

The host store stays the only UI source of truth. Components read the store through their usual selectors. `useSync` only reports fetch flags (`isHydrated`, `isValidating`, `error`, `revalidate`) and never returns data.

## Usage

```ts
import { definePagedReplica, KeyValueReplicaStorage } from '@lobechat/replica';
import { createReplicaSlice, createSWRDriver, recordLens } from '@lobechat/replica/zustand';

const topicList = definePagedReplica<Params, Topic, number, TopicPage>({
  key: ({ agentId }) => `agent_${agentId}`,
  name: 'topicList',
  paging: { direction: 'forward', getId: (t) => t.id, mode: 'offset', persist: { pages: 1 } },
  query: ({ sortBy }) => ({ sortBy }), // query identity beyond the key
  scope, // ReplicaScope: { get, use, canPersist }
  storage: (namespace) => new KeyValueReplicaStorage({ namespace, store }), // see Storage
  version: 1,
});

const slice = createReplicaSlice(topicList, {
  driver: createSWRDriver({ mutate, useSWR }),
  fetcher: fetchTopicPage, // (params, cursor) => { items, total?, nextCursor? }
  get,
  set,
  stateKey: 'topicListReplica', // bookkeeping slot: createReplicaState()
  view: recordLens('topicDataMap'), // where the rendered value lives
});

slice.useSync(params); // in a component: hydrate, then sync
slice.loadMore(key);
slice.optimistic(key, apply, serverCall);
```

A persisted read is asynchronous, so a list hydrated only by `useSync` paints its loading state for a few frames on a cold start. When that list must paint without a skeleton, seed it from the route loader before the route commits: `slice.ensureScope(scope)` + `slice.hydrate(params, scope)`, bounded by `settleWithin(hydrate, ms)` so a stalled storage never holds the route back. A later `useSync` hydrate is a no-op once the slot is filled.

A persisted row is only rewritten when its value changes: a persist whose value is deep-equal to what the engine last wrote to (or hydrated from) that row is skipped, so an unchanged revalidation costs no storage write. A failed write, a delete, an entity patch, an eviction or a `clear()` forgets what the row holds, so the next persist writes it again. The engine only tracks its own writes: a row changed behind it (another tab) is corrected by the next changed value or the next session.

## Storage

A resource persists through any `ReplicaStorage` (`get` / `getStrict` / `set` / `remove`; see [Invalidation](#invalidation) for the failure contract). Two adapters ship with the package, both keyed `<namespace>:<scope>:<queryKey>`:

| Adapter                      | Backing                                                                                                     | Use                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `KeyValueReplicaStorage`     | Any async key-value store `{ get, set, delete, initialize? }`: an IndexedDB object store, SQLite over IPC … | Lists and details of any size. Rows are stored as objects, so the store decides what it can clone.                 |
| `LocalStorageReplicaStorage` | `window.localStorage` through a codec (JSON by default; pass superjson or similar for `Date`, `Map` …)      | Small values that must paint inside pre-paint initialization: `getSync(key)` reads a row without yielding a frame. |

Both reject failed writes and deletes and implement `getStrict`, so every destructive pass works on them. Outside a browser `LocalStorageReplicaStorage` is a no-op miss.

## Fetching without a mounted view

`slice.revalidate(key)` only re-runs the `useSync` queries that are mounted. A store that needs the data while no view is mounted — a hover prefetch, a refresh after a mutation on a route without the list — calls `slice.fetch(params)` instead of calling the service and `replace` by hand:

```ts
const { applied, data, missing } = await slice.fetch(params); // joins a request in flight
await slice.fetch(params, { fresh: true }); // after a mutation: new request, retires older ones
```

Every head response, from `useSync` or `fetch`, goes through one settle pipeline. A request captures its scope, the `clear()` generation, the entry's removal generation and its query when it starts. The response is dropped when any of them moved on (identity switch, `clear()`, `remove` / a pruned entity, a view now showing another query) or when a newer response for the entry already applied. Otherwise it is folded in with `replace`; an `isMissing` answer removes the entry, and an `isMissing` answer captured under a scope the store has since left purges that scope's row instead. `fetch` resolves `{ applied, data, missing }` and rejects when the request fails.

- **Dedupe.** `fetch` joins a request already in flight for the same entry, whether a `useSync` or another `fetch` started it. The request settles once, so effects do not run twice. `{ fresh: true }` starts a new request and retires the older ones, because those may still hold the pre-mutation value.
- **Captured scope.** A flow that fans out from an earlier response (a warmup fetching replies for the roots it got) passes `{ scope }` captured at its start. Each step then settles into that scope. Once the scope is no longer active, `fetch` rejects with `ReplicaScopeChangedError` and sends no request, because the request would read the new identity's data under the old identity's label.
- **Driver cache.** After `fetch` applies a response, it seeds the driver's cache under the sync key (`driver.seed`; for SWR that is `mutate(key, data, { revalidate: false })`). It skips the seed while a `useSync` request for that key is in flight: SWR discards an in-flight request that a write overtakes, so seeding then would drop that request's newer response. SWR still revalidates a later mount unless the sync sets `revalidateIfStale: false`. The value is already in the store, so that revalidation only confirms it.
- **Effects.** Side effects that every response needs go on the slice, not on one view's callbacks:

  ```ts
  createReplicaSlice(resource, {
    effects: {
      onApplied: (data, params, ctx) => {}, // folded into the active scope
      onMissing: (params, ctx) => {}, // `isMissing`, removed from the active scope
      onPurge: (params, ctx) => {}, // `isMissing` captured under a scope left behind
      onError: (error, params, { isActive, key, scope }) => {},
    },
    isMissing: (data) => data === null,
    // …
  });
  ```

  They run for `useSync` responses and `fetch` responses alike. A `useSync` request settles on its own response even when the hook has moved to another key and the driver skips its callback. `useSync`'s per-call `onSuccess` / `onError` remain for UI callbacks of that one view, and `onSuccess` is skipped for a key the hook has left.

Use `revalidate` when the views that show the data are mounted and should refetch on their own schedule. Use `fetch` when the caller needs the data now, needs to know whether it applied, or may run with nothing mounted.

## Invalidation

Persisted rows are kept per entry key **and** per query (`key?<query>`), so a resource can hold several rows for one key. Never delete through a plain `set` or by clearing SWR keys: the persisted rows survive and a reload paints the deleted data. Use the primitive that matches what is gone:

| What is gone                                                                                        | Call                                                           | What it does                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One entity (a deleted topic, file, memory)                                                          | `linkReplicaEntity(...).remove(id)` / `slice.removeEntity(id)` | Drops it from every loaded entry and from persisted rows of unloaded entries. A value hydrated later — even by a read already in flight — comes back without it until a server value holds it again; if the persisted patch does not land (untrusted scope, unreadable storage), the guard stays for the session. |
| One entry key, under every filter / sort                                                            | `slice.remove(key)`                                            | Drops the entry and every persisted query variant of the key. No variant hydrates again until a server `replace` for the key supersedes the removal.                                                                                                                                                              |
| The whole resource ("delete all", a reset)                                                          | `slice.clear()` / `linkReplicaEntity(...).clear()`             | Empties memory in one commit, deletes every persisted row and the index of the active scope, and drops hydrates and `useSync` responses that started before it. Resolves `true` once storage is purged.                                                                                                           |
| The whole resource for a scope that is no longer active (an account switched away mid-"delete all") | `slice.clearScope(scope)`                                      | Deletes every persisted row and the index of `scope` behind the writes this session already queued for it; memory (another scope's, on screen) is untouched. For the active scope it is `clear()`. Resolves `true` once storage is purged.                                                                        |

`slice.updateEntity(id, (item) => undefined)` also drops the entity from loaded values and persisted rows, but it is a plain patch: only `removeEntity` (which `linkReplicaEntity.remove` and an optimistic `'remove'` call) guards hydrates already in flight.

A `ReplicaStorage` must reject from `remove` when a delete did not land, and must implement `getStrict` (a read that rejects on I/O failure) for any destructive pass to succeed: `remove(key)` variant scans, `clear()`, off-scope purges, entity patches of unloaded rows and evictions all read through it, so an unreadable index fails the pass instead of passing for an empty one. A storage without `getStrict` still hydrates and persists, but every destructive pass fails: `clear()` resolves `false`, a removal stays unpurged and is retried, an entity guard is kept. `get` and `set` stay best-effort. The engine then keeps the row indexed and the removal unpurged, so the next `remove(key)` / `clear()` retries it.

Prefer the narrowest call: an entity delete keeps the rest of every list; `remove(key)` is for a key whose whole value is gone or denied (NOT_FOUND / FORBIDDEN); `clear()` is for flows that invalidate everything the user has of that resource. `clear()` does not refetch: mounted views show their loading state until the next sync, so call `slice.revalidate()` after it when the server still has data to show.

## Bounding persisted query variants

Every distinct key + query a resource persists is its own row, so a resource keyed (or queried) by free text — a search, a market filter, a per-topic bundle — would grow storage with every query the user ever ran. Opt in to a cap instead of hand-rolling a recency window around `remove`:

```ts
const searchList = defineReplica<Params, Result>({
  key: ({ keyword }) => keyword,
  name: 'search',
  persist: { maxEntries: 20 }, // at most 20 persisted rows per scope
  // …
});
```

- **What counts.** Persisted storage keys per scope: each `key?query` row counts once.
- **Recency.** A hydrate, a persist, or an unchanged revalidation whose write is skipped marks the row as used. The order is kept in the per-scope index (oldest first), so it survives reloads. Rows an unbounded release indexed keep their append order.
- **Eviction.** Past the cap, the oldest rows go: the row, its index entry, and the memory entry that answers it. An evicted entry is a cache miss. A revisit fetches it again; it is not a removal and does not block hydrates the way `remove` does.
- **Never evicted.** A row with a mounted `useSync` (pinned for as long as it is mounted), an entry with pending optimistic writes, and an entry with a `loadMore` in flight. A view that renders an entry without `useSync` pins it with `slice.retain(key, storageKey)`, which returns the release.
- **Failure.** A failed delete stays indexed and is picked again on the next use. An unreadable index (see `getStrict`) evicts nothing.

## Transcripts and other irregular pages

Message-like resources page backward by cursor, with windows whose length changes on every refresh. The paging config covers them:

| Option / API                                                       | Use                                                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `paging.isCursorable(item)`                                        | Skip synthetic rows (group / summary nodes) when pinning the join anchor or deriving a cursor. A head refresh replaces the head page's synthetic rows by id. |
| `paging.deriveCursor(item)`                                        | Plain lists whose server reports no `nextCursor`: the next cursor comes from the oldest eligible row. Only for rows with a lossless position.                |
| `paging.sort`                                                      | Stable: rows the comparator ties keep server order. Compare positions only.                                                                                  |
| `persistKey(key)`                                                  | Entries that stay in memory (no hydrate, no persist), e.g. scoped buckets.                                                                                   |
| `slice.update(key, fn, { persist: false })` + `slice.persist(key)` | Stream into memory, then persist the confirmed value once.                                                                                                   |
| `splitPagedLens({ itemsField, metaField, derive })`                | Keep raw rows where readers expect them, paging bookkeeping beside them, and derived fields (a parsed display list) in the same commit.                      |

`useSync(params, options)` forwards a sync schedule (`refreshInterval`, `dedupingInterval`, `revalidateIfStale`, `revalidateOnFocus`, …) to the driver, and runs `onSuccess` / `onError` side effects after a response is folded in (resource-wide side effects belong in the slice `effects`, see above). On a cold start with no network (offline / slow), `onHydrated` runs the same "success" handling off the persisted value the hydrate paints, since there is no response for `onSuccess` to run on.
