# Parent-Keyed Lists

Use this variant when the store needs to retain separate lists for multiple parents,
such as datasets under different benchmarks. A single visible list does not need a
parent-keyed map merely because its request has a parent parameter.

The request key and store bucket must identify the same parent. If filters or pages
also need independent retained state, include them in the bucket identity as well as
the SWR key; otherwise a response can overwrite another view's data.

## Store pattern

The following is an illustrative action-class method. `DatasetListItem` denotes the
domain's shared list-item type; use the real service return shape when implementing it.
The domain key factory and service call are shared with ordinary list fetching.

```typescript
interface DatasetSliceState {
  datasetListMap: Record<string, DatasetListItem[]>;
}

useFetchDatasets = (benchmarkId?: string) =>
  useClientDataSWR(
    benchmarkId ? evalKeys.datasets(benchmarkId) : null,
    () => agentEvalService.listDatasets(benchmarkId!),
    {
      onSuccess: (items) => {
        this.#set((state) => ({
          datasetListMap: {
            ...state.datasetListMap,
            [benchmarkId!]: items,
          },
        }));
      },
    },
  );

refreshDatasets = async (benchmarkId: string) => {
  await mutate(evalKeys.datasets(benchmarkId));
};
```

Capture the request's parent id in the callback rather than reading the currently
selected parent when the response arrives. Preserve other buckets during updates.
Add pagination metadata only if the endpoint and surface use it; derive totals and
`hasMore` from the response rather than guessing from the loaded array length.

## Component request state

Read the matching bucket, but use the hook response to distinguish loading, failure,
and a settled result. The example assumes `benchmarkId` is present for the mounted list.

```tsx
const DatasetList = ({ benchmarkId }: { benchmarkId: string }) => {
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const items = useEvalStore((s) => s.datasetListMap[benchmarkId]);
  const { data, error, isLoading, mutate } = useFetchDatasets(benchmarkId);

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
      <DatasetCards items={items ?? []} />
    </AsyncBoundary>
  );
};
```

`EmptyState` and `DatasetCards` stand for the surface's existing renderers. Do not
replace the boundary's `data` with `items ?? []`: an uninitialized bucket would look
like a successful empty result and hide the first-load error.

## Mutation and detail boundaries

Refresh the affected parent after a write, and both parents if an item moves between
them. If a reducer updates the list, dispatch into that same parent bucket. Delete
only after server success; optimistic create/update must recover on failure as
described in the [main skill](../SKILL.md#mutations).

Keep item details keyed by item id, following [Zustand data structures](../../zustand/references/data-structures.md), rather than
introducing one shared `datasetDetail` slot that can display the previous item's data.
For a conditional detail request, pass `undefined` while the surface is inactive and
map it to a `null` SWR key. When active, consume its error/retry state just as for a list.

Use the `zustand` skill for class composition and `flattenActions`; this cache variant
does not require a separate store-wiring or reducer recipe.
