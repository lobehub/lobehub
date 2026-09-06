---
name: data-fetching-architecture
description: 'LobeHub data-fetching pipeline guide. Use for service-layer API calls, store SWR hooks, cache invalidation, async failure states, or migrating useEffect fetches.'
user-invocable: false
---

# LobeHub Data Fetching Architecture

```text
Component → Store useFetchXxx hook → Service → lambdaClient
          ← SWR request state + store data ← response
```

## Layer boundaries

- Services in `src/services/` own API calls: `.query()` for reads, `.mutate()` for writes.
  Export a service instance per domain; components and stores do not call `lambdaClient` directly.
- Store read hooks use `useClientDataSWR` and return its SWR response, including `error`
  and `mutate`. Sync successful results into the store through the wrapper's supported
  callback (`onSuccess`, or `onData` for the sync wrapper).
- Components call these hooks and read store data through selectors. Do not fetch in
  `useEffect` or duplicate server data in component `useState`.
- Use `useFetchXxx` for read hooks and `refreshXxx` for cache invalidation.
- For list/detail types, maps, reducers, and shared type sources, use
  [store-data-structures](../store-data-structures/SKILL.md). For action classes,
  internal actions, and `flattenActions`, use [zustand](../zustand/SKILL.md).

## Cache keys and refresh

Reuse the domain key factory in `src/libs/swr/keys.ts`; define a shared key if the
domain has none. Include every parameter that changes the response: entity or parent
id, filters, sort, and pagination. Read and refresh must construct the same key.

Import `useClientDataSWR` and `mutate` from `@/libs/swr`, keeping the application's
workspace/cache handling. Return a `null` key when a required id is absent; passing
`undefined` to a store hook only disables fetching if that hook maps it to `null`.

For example, inside an action class:

```typescript
useFetchBenchmarks = () =>
  useClientDataSWR(evalKeys.benchmarks(), () => agentEvalService.listBenchmarks(), {
    onSuccess: (data) => {
      this.#set({ benchmarkList: data, benchmarkListInit: true });
    },
  });

refreshBenchmarks = async () => {
  await mutate(evalKeys.benchmarks());
};
```

Read the current [benchmark action](../../../src/store/eval/slices/benchmark/action.ts)
for store wiring and the [SWR wrappers](../../../src/libs/swr/index.ts) for their
actual options. These links locate implementation; they do not make every existing
call site a template to copy unchanged.

Hooks that share a known parent id can run together. If one request needs a value
returned by another, keep its key `null` until that value exists. Do not assume the
application wrapper uses upstream SWR's default deduplication interval.

For lists cached separately under multiple parents, see
[parent-keyed lists](references/walkthrough.md). Ordinary flat lists need no extra layer.

## Mutations

- Call the service, then refresh affected list/detail keys and any related domain
  whose response changed. Await refresh when subsequent UI behavior depends on it.
- Keep pending flags in store state and clear them in `finally`. Use per-id state for
  row updates/deletes so unrelated rows remain usable; create can use a separate flag
  because no persistent id exists yet.
- For optimistic create/update, use the store's reducer/dispatch convention and
  restore or revalidate affected state if the service fails. Do not leave a temporary
  row or a successful-looking edit after rejection.
- Delete after server success, following the `zustand` convention. Do not remove the
  row optimistically or apply create/update's optimistic recipe to deletion.
- Let failures reach the caller's error UI; a `finally` block clears pending state
  but does not by itself recover an optimistic write.

## Render loading, errors, and settled data

Consume the read hook's SWR response. Success-only flags such as `isInit`, missing
map entries, and `data ?? []` cannot distinguish an initial request failure from
loading or empty results.

Use `AsyncBoundary` for standard loading/error/empty/data surfaces; use `AsyncError`
for custom layouts and inline failures. Pass the original SWR `data` to the boundary:
`undefined` means no successful result, whereas `[]` is a settled empty result.

```tsx
const BenchmarkList = () => {
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);
  const benchmarks = useEvalStore((s) => s.benchmarkList);
  const { data, error, isLoading, mutate } = useFetchBenchmarks();

  return (
    <AsyncBoundary
      data={data}
      empty={<EmptyState />}
      error={error}
      isEmpty={data?.length === 0}
      isLoading={isLoading}
      onRetry={() => {
        void mutate();
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

Move the API call into its service and the request into a store SWR hook. Reuse the
existing state shape and action organization unless they need to change for the task.
Replace the component's effect/local fetch state with that hook and selectors, then
connect `error`, retry, and pending feedback. Refresh the same cache key after writes.

Check initial failure, retry, settled-empty results, background failure, and switching
ids against the surface being changed. For stale data, compare read/refresh keys and
the store bucket they update; for stuck loading, inspect rejected requests as well as
success callbacks. Do not add a second fetch or another loading flag to mask the cause.
