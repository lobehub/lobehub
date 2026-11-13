# LobeHub Store Data Structures

How to shape list and detail data in Zustand stores. Request lifecycle, loading and error rendering belong to [data-fetching-architecture](../../data-fetching-architecture/SKILL.md).

## Rules

1. **Types come from `@lobechat/types`**, one entity per file. Never use `@lobechat/database` row types in store state; convert at the boundary.
2. **List item and detail are separate types.** The list item is a subset that drops heavy fields (`content`, `editorData`, `rubrics`, large arrays) and may add computed UI fields (`testCaseCount`). It never `extends` the detail type — that pulls the heavy fields back in. Worked examples: [types](data-structures/types.md).
3. **Details are cached by id** in `xxxDetailMap: Record<string, Detail>`, so switching between detail pages does not refetch and per-row updates stay local. Never hold a single `xxxDetail` object.
4. **Read through selectors** (`xxxSelectors.getXxxDetail(id)`) so components do not repeat map lookups.

## Replica-Backed Shape

A replica's view is always a map keyed by the resource's `key(params)`:

```ts
export interface PageListSliceState {
  pageListMap: Record<string, ReplicaPagedData<LobeDocument, number>>; // one entry per list query
  pageListReplica: ReplicaState<ReplicaPagedData<LobeDocument, number>>;
  pageDetailMap: Record<string, LobeDocument>; // one entry per id
  pageDetailReplica: ReplicaState<LobeDocument>;
}
```

- A list is a map entry too (`pageListMap.all`, `topicDataMap[containerKey]`): paging bookkeeping (`hasMore`, `currentPage`, `isLoadingMore`, `total`) lives on the entry.
- No `xxxListInit` and no `loadingXxxDetailIds`: an `undefined` entry means "not settled yet", and `useSync` reports `isValidating` / `error`.
- When existing readers expect a plain row array, `splitPagedLens` (see the replica README) keeps the rows in their old field and the paging bookkeeping beside it.

## Legacy Shape

Stores not on a replica keep a whole-list array plus a detail map, with explicit flags:

```ts
// src/store/eval/slices/benchmark/initialState.ts
export interface BenchmarkSliceState {
  benchmarkList: AgentEvalBenchmarkListItem[]; // refreshed as a whole
  benchmarkListInit: boolean;
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
  loadingBenchmarkDetailIds: string[]; // per-row pending
  isCreatingBenchmark: boolean; // form-level mutation flags
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}
```

The detail map is written through a reducer when it takes optimistic updates — see [reducer](data-structures/reducer.md) and [Legacy slices](legacy-slices.md).

## Selectors

```ts
export const benchmarkSelectors = {
  getBenchmarkDetail: (id: string) => (s: EvalStore) => s.benchmarkDetailMap[id],
  isLoadingBenchmarkDetail: (id: string) => (s: EvalStore) =>
    s.loadingBenchmarkDetailIds.includes(id),
};

const benchmark = useEvalStore(benchmarkSelectors.getBenchmarkDetail(benchmarkId));
```

Stores are created with `shallow` equality, so a selector may return a fresh array of the same row objects (filter, sort). Returning freshly built objects per row (`.map((r) => ({ ...r }))`) defeats `shallow` and re-renders on every store change.
