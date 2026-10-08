# @lobechat/replica

Every list and detail the UI shows is a **replica**: a local copy of server state that paints on the first frame, then converges on the server in the background.

- **First frame from the replica.** The last confirmed value is read from persistent storage before the network answers, so a reload or a revisit never flashes a skeleton.
- **Server confirms quietly.** The head page from the network replaces the replica. Loaded pages, client-only rows and pending writes survive the replace.
- **Writes land immediately.** Optimistic overlays apply right away. A failed write rolls back to the confirmed base plus any other writes still in flight. Optimistic values never reach storage.
- **One entity, every copy.** `linkReplicaEntity` sends a patch or delete to every replica that holds the entity: the list row, the management page and the detail cache.
- **Identity-safe.** Memory and storage are partitioned by scope (user + workspace). On a scope switch the view is cleared before paint, and late results from the previous scope are dropped.

## Layers

| Entry                       | What it owns                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lobechat/replica`         | Core engine, framework-agnostic: resource definition, pure reducer, paging (offset / cursor, forward / backward), entity links, serialized persistence.                                     |
| `@lobechat/replica/zustand` | Zustand adapter: binds a resource to one location in a domain store (`recordLens`). Adds a `useSync` hook that schedules fetches through a `ReplicaSyncDriver` (`createSWRDriver` for SWR). |

The host store stays the only UI source of truth. Components read the store through their usual selectors. `useSync` only reports fetch flags (`isHydrated`, `isValidating`, `error`, `revalidate`) and never returns data.

## Usage

```ts
import { definePagedReplica } from '@lobechat/replica';
import { createReplicaSlice, createSWRDriver, recordLens } from '@lobechat/replica/zustand';

const topicList = definePagedReplica<Params, Topic, number, TopicPage>({
  key: ({ agentId }) => `agent_${agentId}`,
  name: 'topicList',
  paging: { direction: 'forward', getId: (t) => t.id, mode: 'offset', persist: { pages: 1 } },
  query: ({ sortBy }) => ({ sortBy }), // query identity beyond the key
  scope, // ReplicaScope: { get, use, canPersist }
  storage: (namespace) => new MyIndexedDBStorage(namespace), // ReplicaStorage
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

Inside LobeHub, use `@/libs/replica`. It presets the cache scope, IndexedDB / localStorage storage and the app's SWR driver.

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

`useSync(params, options)` forwards a sync schedule (`refreshInterval`, `dedupingInterval`, `revalidateIfStale`, `revalidateOnFocus`, …) to the driver, and runs `onSuccess` / `onError` side effects after a response is folded in.
