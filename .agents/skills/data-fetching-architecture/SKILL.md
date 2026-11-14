---
name: data-fetching-architecture
description: 'Use for client APIs, SWR hooks, cache invalidation, async errors, useEffect migration, home first paint and persistent caches.'
user-invocable: false
---

# LobeHub Data Fetching Architecture

```text
Component → Store useFetchXxx hook → replica slice → Service → lambdaClient
          ← sync flags + store data (selectors) ← response
```

New server data the UI paints goes through `local-replica` (`@/libs/replica`), not a
new SWR key. `src/libs/swr/keys.ts` is frozen: `src/libs/swr/keys.frozen.test.ts`
fails on any added key, and its legacy list only shrinks.

## Layer boundaries

- Services in `src/services/` own API calls: `.query()` for reads, `.mutate()` for writes.
  Export a service instance per domain; components and stores do not call `lambdaClient` directly.
- Server lists and details go through `@/libs/replica`: the store's `useFetchXxx`
  returns `slice.useSync(params)` (flags only) and the engine writes the store. See
  the Replica section of [zustand](../zustand/SKILL.md).
- `useClientDataSWR` + `onSuccess` syncing into the store is the legacy layout. Keep
  it only inside an existing hook whose key is already in `src/libs/swr/keys.ts`; do
  not add keys or new SWR-backed store hooks for server data.
- Components call these hooks and read store data through selectors. Do not fetch in
  `useEffect` or duplicate server data in component `useState`.
- Use `useFetchXxx` for read hooks and `refreshXxx` for cache invalidation.
- For list/detail types, maps, reducers, and shared type sources, use
  [Zustand data structures](../zustand/references/data-structures.md). For store layout
  and action classes, use [zustand](../zustand/SKILL.md).

## Home First Paint and Persistent Caches

When changing home/sidebar first paint or persisted display data, read
[`references/home-first-paint.md`](./references/home-first-paint.md). It covers
avoiding flicker, reusing persistence, and the user `displaySnapshot.ts` boundary.

## Cache keys and refresh

Do not add SWR keys. A resource that needs a new key gets a replica instead
(`defineReplica` / `definePagedReplica` in the store's `projection.ts`). The replica
params replace the key, so include every parameter that changes the response:
entity or parent id, filters, sort, and pagination. Refresh with
`slice.fetch(params, { fresh: true })` or `revalidate()` from `useSync`; read and
refresh must use the same params. Disable a sync whose required id is absent with
`useSync(params, { enabled: false })`.

For example, inside an action class:

```typescript
useFetchAgentLabels = (isLogin: boolean | undefined): ReplicaSyncResult =>
  this.#labels.useSync(LIST_PARAMS, { enabled: isLogin === true });

refreshAgentLabels = async () => {
  await this.#labels.revalidate();
};
```

Read the current [label action](../../../src/store/home/slices/label/action.ts) for
store wiring. These links locate implementation; they do not make every existing
call site a template to copy unchanged.

Legacy SWR hooks keep their existing key from `src/libs/swr/keys.ts` and import
`useClientDataSWR` and `mutate` from `@/libs/swr`. When you migrate one to a replica,
delete its key and its entry in `keys.frozen.test.ts`.

Hooks that share a known parent id can run together. If one request needs a value
returned by another, keep it disabled until that value exists.

For lists cached separately under multiple parents, see
[parent-keyed lists](references/walkthrough.md). Ordinary flat lists need no extra layer.

## Mutations

- Call the service, then refresh affected list/detail keys and any related domain
  whose response changed. Await refresh when subsequent UI behavior depends on it.
- Keep pending flags in store state and clear them in `finally`. Use per-id state for
  row updates/deletes so unrelated rows remain usable; create can use a separate flag
  because no persistent id exists yet.
- For optimistic writes on replica data, use `slice.optimistic` / `entity.optimistic`;
  a rejected call rolls back on its own, deletes included.
- For optimistic create/update on legacy stores, use the store's reducer/dispatch
  convention and restore or revalidate affected state if the service fails. Do not
  leave a temporary row or a successful-looking edit after rejection. Delete only after
  server success there: a hand-written reducer has no rollback base.
- Let failures reach the caller's error UI; a `finally` block clears pending state
  but does not by itself recover an optimistic write.

## Render loading, errors, and settled data

Success-only flags such as `isInit`, missing map entries, and `data ?? []` cannot
distinguish an initial request failure from loading or empty results.

Use `AsyncBoundary` for standard loading/error/empty/data surfaces; use `AsyncError`
for custom layouts and inline failures. `undefined` data means no successful result,
whereas `[]` is a settled empty result.

Replica `useSync` returns no `data`. Feed `AsyncBoundary` its `error` and a settled
signal from the store entry (`data={isListInit || undefined}`, where the selector is
`entry !== undefined`); see `src/features/Pages/PageLayout/Body/index.tsx`. Legacy
SWR hooks pass the original SWR `data` instead.

```tsx
const BenchmarkList = () => {
  const { error, revalidate } = benchmarkActions.useFetchBenchmarks();
  const isListInit = useEvalStore(benchmarkSelectors.isBenchmarkListInit);
  const benchmarks = useEvalStore(benchmarkSelectors.benchmarkList);

  return (
    <AsyncBoundary
      data={isListInit || undefined}
      empty={<EmptyState />}
      error={error}
      isEmpty={benchmarks.length === 0}
      isLoading={!isListInit && !error}
      onRetry={() => {
        void revalidate();
      }}
    >
      <BenchmarkCards items={benchmarks} />
    </AsyncBoundary>
  );
};
```

The example's `EmptyState` and `BenchmarkCards` stand for the surface's existing
renderers. Follow these distinctions when adapting it:

- Show first-load errors before empty / `NotFound` / zero-value defaults. Do not put
  an error branch after `if (!map[id]) return <Skeleton />`; failure may never fill the map.
- Preserve settled content during background revalidation failures, including a
  successfully loaded empty list. A retry in flight should show pending feedback.
- In a fetched + static list, use the fetched slice's request state before combining
  rows. Static rows must not hide a failed request.
- For infinite scroll, keep a per-bucket `loadMoreError` and show an inline Retry row.
  Suspend observer-triggered retries while that error is unresolved.
- A closed modal or absent id disables a request; it is not evidence of a missing record.

## Migrating an existing fetch

Move the API call into its service and the request into a replica-backed store hook.
Reuse the existing action organization unless it needs to change for the task.
Replace the component's effect/local fetch state with that hook and selectors, then
connect `error`, retry, and pending feedback. Refresh the same replica params after
writes.

Check initial failure, retry, settled-empty results, background failure, and switching
ids against the surface being changed. For stale data, compare read/refresh params (or
legacy keys) and the store bucket they update; for stuck loading, inspect rejected requests as well as
success callbacks. Do not add a second fetch or another loading flag to mask the cause.
