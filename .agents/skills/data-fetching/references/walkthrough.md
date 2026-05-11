# Walkthrough: Adding a New Feature End-to-End

This is a worked example of the canonical 6-step recipe applied to a new entity (`Dataset`), showing a variant of the main skill's pattern: **a list keyed by a parent id** (`datasetMap[benchmarkId]`), useful when the same shape appears under different parents.

If you only need the canonical (single-array) pattern, the main `SKILL.md` already shows it for `Benchmark`. Read this file when you need the parent-keyed Map variant, or when you want a checklist-style walkthrough.

## Step 1: Add Service methods

```typescript
class AgentEvalService {
  async listDatasets(benchmarkId: string) {
    return lambdaClient.agentEval.listDatasets.query({ benchmarkId });
  }
  async getDataset(id: string) {
    return lambdaClient.agentEval.getDataset.query({ id });
  }
  async createDataset(params: CreateDatasetParams) {
    return lambdaClient.agentEval.createDataset.mutate(params);
  }
  // updateDataset / deleteDataset follow the same shape
}
```

## Step 2: Reducer (optimistic updates)

```typescript
// src/store/eval/slices/dataset/reducer.ts
export type DatasetDispatch =
  | { type: 'addDataset'; value: Dataset }
  | { type: 'updateDataset'; id: string; value: Partial<Dataset> }
  | { type: 'deleteDataset'; id: string };

export const datasetReducer = (state: Dataset[] = [], payload: DatasetDispatch): Dataset[] =>
  produce(state, (draft) => {
    switch (payload.type) {
      case 'addDataset':
        draft.unshift(payload.value);
        break;
      case 'updateDataset': {
        const i = draft.findIndex((item) => item.id === payload.id);
        if (i !== -1) draft[i] = { ...draft[i], ...payload.value };
        break;
      }
      case 'deleteDataset': {
        const i = draft.findIndex((item) => item.id === payload.id);
        if (i !== -1) draft.splice(i, 1);
        break;
      }
    }
  });
```

## Step 3: Store slice

```typescript
// src/store/eval/slices/dataset/initialState.ts
export interface DatasetData {
  currentPage: number;
  hasMore: boolean;
  isLoading: boolean;
  items: Dataset[];
  pageSize: number;
  total: number;
}

export interface DatasetSliceState {
  // Map keyed by benchmarkId — multiple parent contexts share the slice
  datasetMap: Record<string, DatasetData>;
  // Single item for modal display
  datasetDetail: Dataset | null;
  isLoadingDatasetDetail: boolean;
  loadingDatasetIds: string[];
}

export const datasetInitialState: DatasetSliceState = {
  datasetMap: {},
  datasetDetail: null,
  isLoadingDatasetDetail: false,
  loadingDatasetIds: [],
};
```

```typescript
// src/store/eval/slices/dataset/action.ts
const FETCH_DATASETS_KEY = 'FETCH_DATASETS';
const FETCH_DATASET_DETAIL_KEY = 'FETCH_DATASET_DETAIL';

export const createDatasetSlice: StateCreator<EvalStore, any, [], DatasetAction> = (set, get) => ({
  // Cache key includes benchmarkId so each parent has its own SWR entry
  useFetchDatasets: (benchmarkId) =>
    useClientDataSWR(
      benchmarkId ? [FETCH_DATASETS_KEY, benchmarkId] : null,
      () => agentEvalService.listDatasets(benchmarkId!),
      {
        onSuccess: (data) => {
          set({
            datasetMap: {
              ...get().datasetMap,
              [benchmarkId!]: {
                currentPage: 1,
                hasMore: false,
                isLoading: false,
                items: data,
                pageSize: data.length,
                total: data.length,
              },
            },
          });
        },
      },
    ),

  useFetchDatasetDetail: (id) =>
    useClientDataSWR(
      id ? [FETCH_DATASET_DETAIL_KEY, id] : null,
      () => agentEvalService.getDataset(id!),
      {
        onSuccess: (data) => set({ datasetDetail: data, isLoadingDatasetDetail: false }),
      },
    ),

  refreshDatasets: (benchmarkId) => mutate([FETCH_DATASETS_KEY, benchmarkId]),
  refreshDatasetDetail: (id) => mutate([FETCH_DATASET_DETAIL_KEY, id]),

  // CREATE with optimistic update — note the temp id pattern
  createDataset: async (params) => {
    const tmpId = Date.now().toString();
    const { benchmarkId } = params;

    get().internal_dispatchDataset(
      { type: 'addDataset', value: { ...params, id: tmpId, createdAt: Date.now() } as any },
      benchmarkId,
    );
    get().internal_updateDatasetLoading(tmpId, true);

    try {
      const result = await agentEvalService.createDataset(params);
      await get().refreshDatasets(benchmarkId);
      return result;
    } finally {
      get().internal_updateDatasetLoading(tmpId, false);
    }
  },

  // UPDATE / DELETE follow the same optimistic + refresh pattern as BenchmarkSlice
  // (see the main SKILL.md)

  // Internal — dispatch reducer scoped to a parent
  internal_dispatchDataset: (payload, benchmarkId) => {
    const currentData = get().datasetMap[benchmarkId];
    const nextItems = datasetReducer(currentData?.items, payload);

    // Skip set when nothing changed — avoids unnecessary re-renders
    if (isEqual(nextItems, currentData?.items)) return;

    set({
      datasetMap: {
        ...get().datasetMap,
        [benchmarkId]: {
          ...currentData,
          currentPage: currentData?.currentPage ?? 1,
          hasMore: currentData?.hasMore ?? false,
          isLoading: false,
          items: nextItems,
          pageSize: currentData?.pageSize ?? nextItems.length,
          total: currentData?.total ?? nextItems.length,
        },
      },
    });
  },

  internal_updateDatasetLoading: (id, loading) => {
    set((state) => ({
      loadingDatasetIds: loading
        ? [...state.loadingDatasetIds, id]
        : state.loadingDatasetIds.filter((i) => i !== id),
    }));
  },
});
```

## Step 4: Wire into the store

```typescript
// src/store/eval/store.ts
export type EvalStore = EvalStoreState & BenchmarkAction & DatasetAction & RunAction;

const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (set, get, store) => ({
  ...initialState,
  ...createBenchmarkSlice(set, get, store),
  ...createDatasetSlice(set, get, store),
  ...createRunSlice(set, get, store),
});

// src/store/eval/initialState.ts
export const initialState: EvalStoreState = {
  ...benchmarkInitialState,
  ...datasetInitialState,
  ...runInitialState,
};
```

## Step 5: Selectors (optional but recommended)

```typescript
export const datasetSelectors = {
  getDatasetData: (benchmarkId: string) => (s: EvalStore) => s.datasetMap[benchmarkId],
  getDatasets: (benchmarkId: string) => (s: EvalStore) => s.datasetMap[benchmarkId]?.items ?? [],
  isLoadingDataset: (id: string) => (s: EvalStore) => s.loadingDatasetIds.includes(id),
};
```

## Step 6: Use in component

```tsx
// List scoped to a parent
const DatasetList = ({ benchmarkId }: { benchmarkId: string }) => {
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const datasets = useEvalStore(datasetSelectors.getDatasets(benchmarkId));
  const datasetData = useEvalStore(datasetSelectors.getDatasetData(benchmarkId));

  useFetchDatasets(benchmarkId);

  if (datasetData?.isLoading) return <Loading />;
  return (
    <div>
      <h2>Total: {datasetData?.total ?? 0}</h2>
      <List data={datasets} />
    </div>
  );
};

// Single item for modal — conditional fetching pattern
const DatasetImportModal = ({ open, datasetId }: Props) => {
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const dataset = useEvalStore((s) => s.datasetDetail);
  const isLoading = useEvalStore((s) => s.isLoadingDatasetDetail);

  // Only fetch when modal is open AND id present
  useFetchDatasetDetail(open && datasetId ? datasetId : undefined);

  return <Modal open={open}>{isLoading ? <Loading /> : <div>{dataset?.name}</div>}</Modal>;
};
```
