---
name: data-fetching
description: Data fetching architecture guide using Service layer + Zustand Store + SWR. Use when implementing data fetching, creating services, working with store hooks, or migrating from useEffect. Triggers on data loading, API calls, service creation, or store data fetching tasks.
---

# LobeHub Data Fetching Architecture

> **Related Skills:**
>
> - `store-data-structures` - How to structure List and Detail data in stores (Map vs Array patterns)

## Architecture Overview

```
┌─────────────┐
│  Component  │
└──────┬──────┘
       │ 1. Call useFetchXxx hook from store
       ↓
┌──────────────────┐
│  Zustand Store   │
│  (State + Hook)  │
└──────┬───────────┘
       │ 2. useClientDataSWR calls service
       ↓
┌──────────────────┐
│  Service Layer   │
│  (xxxService)    │
└──────┬───────────┘
       │ 3. Call lambdaClient
       ↓
┌──────────────────┐
│  lambdaClient    │
│  (TRPC Client)   │
└──────────────────┘
```

## Core Principles

### ✅ DO

1. **Use Service Layer** for all API calls
2. **Use Store SWR Hooks** for data fetching (not useEffect)
3. **Use proper data structures** - See `store-data-structures` skill for List vs Detail patterns
4. **Use lambdaClient.mutate** for write operations (create/update/delete)
5. **Use lambdaClient.query** only inside service methods

### ❌ DON'T

1. **Never use useEffect** for data fetching
2. **Never call lambdaClient** directly in components or stores
3. **Never use useState** for server data
4. **Never mix data structure patterns** - Follow `store-data-structures` skill

> **Note:** For data structure patterns (Map vs Array, List vs Detail), see the `store-data-structures` skill.

---

## Layer 1: Service Layer

### Purpose

- Encapsulate all API calls to lambdaClient
- Provide clean, typed interfaces
- Single source of truth for API operations

### Service Structure

```typescript
// src/services/agentEval.ts
import { lambdaClient } from '@/libs/trpc/client';

class AgentEvalService {
  // Query methods - READ operations
  async listBenchmarks() {
    return lambdaClient.agentEval.listBenchmarks.query();
  }

  async getBenchmark(id: string) {
    return lambdaClient.agentEval.getBenchmark.query({ id });
  }

  // Mutation methods - WRITE operations
  async createBenchmark(params: CreateBenchmarkParams) {
    return lambdaClient.agentEval.createBenchmark.mutate(params);
  }

  async updateBenchmark(params: UpdateBenchmarkParams) {
    return lambdaClient.agentEval.updateBenchmark.mutate(params);
  }

  async deleteBenchmark(id: string) {
    return lambdaClient.agentEval.deleteBenchmark.mutate({ id });
  }
}

export const agentEvalService = new AgentEvalService();
```

### Service Guidelines

1. **One service per domain** (e.g., agentEval, ragEval, aiAgent)
2. **Export singleton instance** (`export const xxxService = new XxxService()`)
3. **Method names match operations** (list, get, create, update, delete)
4. **Clear parameter types** (use interfaces for complex params)

---

## Layer 2: Store with SWR Hooks

### Purpose

- Manage client-side state
- Provide SWR hooks for data fetching
- Handle cache invalidation

> **Data Structure:** See `store-data-structures` skill for how to structure List and Detail data.

### Store Structure Overview

```typescript
// src/store/eval/slices/benchmark/initialState.ts
import type { AgentEvalBenchmark, AgentEvalBenchmarkListItem } from '@lobechat/types';

export interface BenchmarkSliceState {
  // List data - simple array (see store-data-structures skill)
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  // Detail data - map for caching (see store-data-structures skill)
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
  loadingBenchmarkDetailIds: string[];

  // Mutation states
  isCreatingBenchmark: boolean;
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}
```

> For complete initialState, reducer, and internal dispatch patterns, see the `store-data-structures` skill.

### Create Actions

```typescript
// src/store/eval/slices/benchmark/action.ts
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';
import isEqual from 'fast-deep-equal';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { benchmarkDetailReducer, type BenchmarkDetailDispatch } from './reducer';

const FETCH_BENCHMARKS_KEY = 'FETCH_BENCHMARKS';
const FETCH_BENCHMARK_DETAIL_KEY = 'FETCH_BENCHMARK_DETAIL';

export interface BenchmarkAction {
  // SWR Hooks - for data fetching
  useFetchBenchmarks: () => SWRResponse;
  useFetchBenchmarkDetail: (id?: string) => SWRResponse;

  // Refresh methods - for cache invalidation
  refreshBenchmarks: () => Promise<void>;
  refreshBenchmarkDetail: (id: string) => Promise<void>;

  // Mutation actions - for write operations
  createBenchmark: (params: CreateParams) => Promise<any>;
  updateBenchmark: (params: UpdateParams) => Promise<void>;
  deleteBenchmark: (id: string) => Promise<void>;

  // Internal methods - not for direct UI use
  internal_dispatchBenchmarkDetail: (payload: BenchmarkDetailDispatch) => void;
  internal_updateBenchmarkDetailLoading: (id: string, loading: boolean) => void;
}

export const createBenchmarkSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  BenchmarkAction
> = (set, get) => ({
  // Fetch list - Simple array
  useFetchBenchmarks: () => {
    return useClientDataSWR(FETCH_BENCHMARKS_KEY, () => agentEvalService.listBenchmarks(), {
      onSuccess: (data: any) => {
        set(
          {
            benchmarkList: data,
            benchmarkListInit: true,
          },
          false,
          'useFetchBenchmarks/success',
        );
      },
    });
  },

  // Fetch detail - Map with dispatch
  useFetchBenchmarkDetail: (id) => {
    return useClientDataSWR(
      id ? [FETCH_BENCHMARK_DETAIL_KEY, id] : null,
      () => agentEvalService.getBenchmark(id!),
      {
        onSuccess: (data: any) => {
          get().internal_dispatchBenchmarkDetail({
            type: 'setBenchmarkDetail',
            id: id!,
            value: data,
          });
          get().internal_updateBenchmarkDetailLoading(id!, false);
        },
      },
    );
  },

  // Refresh methods
  refreshBenchmarks: async () => {
    await mutate(FETCH_BENCHMARKS_KEY);
  },

  refreshBenchmarkDetail: async (id) => {
    await mutate([FETCH_BENCHMARK_DETAIL_KEY, id]);
  },

  // CREATE - Refresh list after creation
  createBenchmark: async (params) => {
    set({ isCreatingBenchmark: true }, false, 'createBenchmark/start');
    try {
      const result = await agentEvalService.createBenchmark(params);
      await get().refreshBenchmarks();
      return result;
    } finally {
      set({ isCreatingBenchmark: false }, false, 'createBenchmark/end');
    }
  },

  // UPDATE - With optimistic update for detail
  updateBenchmark: async (params) => {
    const { id } = params;

    // 1. Optimistic update
    get().internal_dispatchBenchmarkDetail({
      type: 'updateBenchmarkDetail',
      id,
      value: params,
    });

    // 2. Set loading
    get().internal_updateBenchmarkDetailLoading(id, true);

    try {
      // 3. Call service
      await agentEvalService.updateBenchmark(params);

      // 4. Refresh from server
      await get().refreshBenchmarks();
      await get().refreshBenchmarkDetail(id);
    } finally {
      get().internal_updateBenchmarkDetailLoading(id, false);
    }
  },

  // DELETE - Refresh list and remove from detail map
  deleteBenchmark: async (id) => {
    // 1. Optimistic update
    get().internal_dispatchBenchmarkDetail({
      type: 'deleteBenchmarkDetail',
      id,
    });

    // 2. Set loading
    get().internal_updateBenchmarkDetailLoading(id, true);

    try {
      // 3. Call service
      await agentEvalService.deleteBenchmark(id);

      // 4. Refresh list
      await get().refreshBenchmarks();
    } finally {
      get().internal_updateBenchmarkDetailLoading(id, false);
    }
  },

  // Internal - Dispatch to reducer (for detail map)
  internal_dispatchBenchmarkDetail: (payload) => {
    const currentMap = get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    // No need to update if map is the same
    if (isEqual(nextMap, currentMap)) return;

    set({ benchmarkDetailMap: nextMap }, false, `dispatchBenchmarkDetail/${payload.type}`);
  },

  // Internal - Update loading state for specific detail
  internal_updateBenchmarkDetailLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          return { loadingBenchmarkDetailIds: [...state.loadingBenchmarkDetailIds, id] };
        }
        return {
          loadingBenchmarkDetailIds: state.loadingBenchmarkDetailIds.filter((i) => i !== id),
        };
      },
      false,
      'updateBenchmarkDetailLoading',
    );
  },
});
```

### Store Guidelines

1. **SWR keys as constants** at top of file
2. **useClientDataSWR** for all data fetching (never useEffect)
3. **onSuccess callback** updates store state
4. **Refresh methods** use `mutate()` to invalidate cache
5. **Loading states** in initialState, updated in onSuccess
6. **Mutations** call service, then refresh relevant cache

---

## Layer 3: Component Usage

### Data Fetching in Components

**Fetching List Data:**

```typescript
// Component using list data - ✅ CORRECT
import { useEvalStore } from '@/store/eval';

const BenchmarkList = () => {
  // 1. Get the hook from store
  const useFetchBenchmarks = useEvalStore((s) => s.useFetchBenchmarks);

  // 2. Get list data
  const benchmarks = useEvalStore((s) => s.benchmarkList);
  const isInit = useEvalStore((s) => s.benchmarkListInit);

  // 3. Call the hook (SWR handles the data fetching)
  useFetchBenchmarks();

  // 4. Use the data
  if (!isInit) return <Loading />;
  return (
    <div>
      <h2>Total: {benchmarks.length}</h2>
      {benchmarks.map(b => <BenchmarkCard key={b.id} {...b} />)}
    </div>
  );
};
```

**Fetching Detail Data:**

```typescript
// Component using detail data from map - ✅ CORRECT
import { useEvalStore } from '@/store/eval';
import { useParams } from 'react-router-dom';

const BenchmarkDetail = () => {
  const { benchmarkId } = useParams<{ benchmarkId: string }>();

  // 1. Get the hook
  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);

  // 2. Get detail from map
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );

  // 3. Get loading state
  const isLoading = useEvalStore((s) =>
    benchmarkId ? s.loadingBenchmarkDetailIds.includes(benchmarkId) : false,
  );

  // 4. Call the hook
  useFetchBenchmarkDetail(benchmarkId);

  // 5. Use the data
  if (!benchmark) return <Loading />;
  return (
    <div>
      <h1>{benchmark.name}</h1>
      <p>{benchmark.description}</p>
      {isLoading && <Spinner />}
    </div>
  );
};
```

**Using Selectors (Recommended):**

```typescript
// src/store/eval/slices/benchmark/selectors.ts
export const benchmarkSelectors = {
  getBenchmarkDetail: (id: string) => (s: EvalStore) => s.benchmarkDetailMap[id],
  isLoadingBenchmarkDetail: (id: string) => (s: EvalStore) =>
    s.loadingBenchmarkDetailIds.includes(id),
};

// Component with selectors
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams();
  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const benchmark = useEvalStore(benchmarkSelectors.getBenchmarkDetail(benchmarkId!));

  useFetchBenchmarkDetail(benchmarkId);

  return <div>{benchmark && <h1>{benchmark.name}</h1>}</div>;
};
```

### What NOT to Do

```typescript
// ❌ WRONG - Don't use useEffect for data fetching
const BenchmarkList = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const result = await lambdaClient.agentEval.listBenchmarks.query();
      setData(result);
      setLoading(false);
    };
    fetchData();
  }, []);

  return <div>...</div>;
};
```

### Mutations in Components

```typescript
// Mutations (Create/Update/Delete) with optimistic updates - ✅ CORRECT
import { useEvalStore } from '@/store/eval';
import { benchmarkSelectors } from '@/store/eval/selectors';

const CreateBenchmarkModal = () => {
  const createBenchmark = useEvalStore((s) => s.createBenchmark);

  const handleSubmit = async (values) => {
    try {
      // Optimistic update happens inside createBenchmark
      await createBenchmark(values);
      message.success('Created successfully');
      onClose();
    } catch (error) {
      message.error('Failed to create');
    }
  };

  return <Form onSubmit={handleSubmit}>...</Form>;
};

// With loading state for specific item
const BenchmarkItem = ({ id }: { id: string }) => {
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);
  const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
  const isLoading = useEvalStore(benchmarkSelectors.isLoadingBenchmark(id));

  const handleUpdate = async (data) => {
    await updateBenchmark({ id, ...data });
  };

  const handleDelete = async () => {
    await deleteBenchmark(id);
  };

  return (
    <div>
      {isLoading && <Spinner />}
      <button onClick={handleUpdate}>Update</button>
      <button onClick={handleDelete}>Delete</button>
    </div>
  );
};
```

---

> **Data Structures:** For detailed comparison of List vs Detail patterns, see the `store-data-structures` skill.

---

## Complete Example: Adding a New Feature

### Scenario: Add "Dataset" data fetching with optimistic updates

#### Step 1: Create Service

```typescript
// src/services/agentEval.ts
class AgentEvalService {
  // ... existing methods ...

  // Add new methods
  async listDatasets(benchmarkId: string) {
    return lambdaClient.agentEval.listDatasets.query({ benchmarkId });
  }

  async getDataset(id: string) {
    return lambdaClient.agentEval.getDataset.query({ id });
  }

  async createDataset(params: CreateDatasetParams) {
    return lambdaClient.agentEval.createDataset.mutate(params);
  }
}
```

#### Step 2: Create Reducer

```typescript
// src/store/eval/slices/dataset/reducer.ts
import { produce } from 'immer';
import type { Dataset } from '@/types/dataset';

type AddDatasetAction = {
  type: 'addDataset';
  value: Dataset;
};

type UpdateDatasetAction = {
  id: string;
  type: 'updateDataset';
  value: Partial<Dataset>;
};

type DeleteDatasetAction = {
  id: string;
  type: 'deleteDataset';
};

export type DatasetDispatch = AddDatasetAction | UpdateDatasetAction | DeleteDatasetAction;

export const datasetReducer = (state: Dataset[] = [], payload: DatasetDispatch): Dataset[] => {
  switch (payload.type) {
    case 'addDataset': {
      return produce(state, (draft) => {
        draft.unshift(payload.value);
      });
    }

    case 'updateDataset': {
      return produce(state, (draft) => {
        const index = draft.findIndex((item) => item.id === payload.id);
        if (index !== -1) {
          draft[index] = { ...draft[index], ...payload.value };
        }
      });
    }

    case 'deleteDataset': {
      return produce(state, (draft) => {
        const index = draft.findIndex((item) => item.id === payload.id);
        if (index !== -1) {
          draft.splice(index, 1);
        }
      });
    }

    default:
      return state;
  }
};
```

#### Step 3: Create Store Slice

```typescript
// src/store/eval/slices/dataset/initialState.ts
import type { Dataset } from '@/types/dataset';

export interface DatasetData {
  currentPage: number;
  hasMore: boolean;
  isLoading: boolean;
  items: Dataset[];
  pageSize: number;
  total: number;
}

export interface DatasetSliceState {
  // Map keyed by benchmarkId
  datasetMap: Record<string, DatasetData>;
  // Simple state for single item (read-only, used in modals)
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
import type { SWRResponse } from 'swr';
import type { StateCreator } from 'zustand/vanilla';
import isEqual from 'fast-deep-equal';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { agentEvalService } from '@/services/agentEval';
import type { EvalStore } from '@/store/eval/store';
import { datasetReducer, type DatasetDispatch } from './reducer';

const FETCH_DATASETS_KEY = 'FETCH_DATASETS';
const FETCH_DATASET_DETAIL_KEY = 'FETCH_DATASET_DETAIL';

export interface DatasetAction {
  // SWR Hooks
  useFetchDatasets: (benchmarkId?: string) => SWRResponse;
  useFetchDatasetDetail: (id?: string) => SWRResponse;

  // Refresh methods
  refreshDatasets: (benchmarkId: string) => Promise<void>;
  refreshDatasetDetail: (id: string) => Promise<void>;

  // Mutations
  createDataset: (params: any) => Promise<any>;
  updateDataset: (params: any) => Promise<void>;
  deleteDataset: (id: string, benchmarkId: string) => Promise<void>;

  // Internal methods
  internal_dispatchDataset: (payload: DatasetDispatch, benchmarkId: string) => void;
  internal_updateDatasetLoading: (id: string, loading: boolean) => void;
}

export const createDatasetSlice: StateCreator<
  EvalStore,
  [['zustand/devtools', never]],
  [],
  DatasetAction
> = (set, get) => ({
  // Fetch list with Map
  useFetchDatasets: (benchmarkId) => {
    return useClientDataSWR(
      benchmarkId ? [FETCH_DATASETS_KEY, benchmarkId] : null,
      () => agentEvalService.listDatasets(benchmarkId!),
      {
        onSuccess: (data: any) => {
          set(
            {
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
            },
            false,
            'useFetchDatasets/success',
          );
        },
      },
    );
  },

  // Fetch single item (for modal display)
  useFetchDatasetDetail: (id) => {
    return useClientDataSWR(
      id ? [FETCH_DATASET_DETAIL_KEY, id] : null,
      () => agentEvalService.getDataset(id!),
      {
        onSuccess: (data: any) => {
          set(
            { datasetDetail: data, isLoadingDatasetDetail: false },
            false,
            'useFetchDatasetDetail/success',
          );
        },
      },
    );
  },

  refreshDatasets: async (benchmarkId) => {
    await mutate([FETCH_DATASETS_KEY, benchmarkId]);
  },

  refreshDatasetDetail: async (id) => {
    await mutate([FETCH_DATASET_DETAIL_KEY, id]);
  },

  // CREATE with optimistic update
  createDataset: async (params) => {
    const tmpId = Date.now().toString();
    const { benchmarkId } = params;

    get().internal_dispatchDataset(
      {
        type: 'addDataset',
        value: { ...params, id: tmpId, createdAt: Date.now() } as any,
      },
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

  // UPDATE with optimistic update
  updateDataset: async (params) => {
    const { id, benchmarkId } = params;

    get().internal_dispatchDataset(
      {
        type: 'updateDataset',
        id,
        value: params,
      },
      benchmarkId,
    );

    get().internal_updateDatasetLoading(id, true);

    try {
      await agentEvalService.updateDataset(params);
      await get().refreshDatasets(benchmarkId);
    } finally {
      get().internal_updateDatasetLoading(id, false);
    }
  },

  // DELETE with optimistic update
  deleteDataset: async (id, benchmarkId) => {
    get().internal_dispatchDataset(
      {
        type: 'deleteDataset',
        id,
      },
      benchmarkId,
    );

    get().internal_updateDatasetLoading(id, true);

    try {
      await agentEvalService.deleteDataset(id);
      await get().refreshDatasets(benchmarkId);
    } finally {
      get().internal_updateDatasetLoading(id, false);
    }
  },

  // Internal - Dispatch to reducer
  internal_dispatchDataset: (payload, benchmarkId) => {
    const currentData = get().datasetMap[benchmarkId];
    const nextItems = datasetReducer(currentData?.items, payload);

    if (isEqual(nextItems, currentData?.items)) return;

    set(
      {
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
      },
      false,
      `dispatchDataset/${payload.type}`,
    );
  },

  // Internal - Update loading state
  internal_updateDatasetLoading: (id, loading) => {
    set(
      (state) => {
        if (loading) {
          return { loadingDatasetIds: [...state.loadingDatasetIds, id] };
        }
        return {
          loadingDatasetIds: state.loadingDatasetIds.filter((i) => i !== id),
        };
      },
      false,
      'updateDatasetLoading',
    );
  },
});
```

#### Step 3: Integrate into Store

```typescript
// src/store/eval/store.ts
import { createDatasetSlice, type DatasetAction } from './slices/dataset/action';

export type EvalStore = EvalStoreState &
  BenchmarkAction &
  DatasetAction & // Add here
  RunAction;

const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (set, get, store) => ({
  ...initialState,
  ...createBenchmarkSlice(set, get, store),
  ...createDatasetSlice(set, get, store), // Add here
  ...createRunSlice(set, get, store),
});
```

```typescript
// src/store/eval/initialState.ts
import { datasetInitialState, type DatasetSliceState } from './slices/dataset/initialState';

export interface EvalStoreState extends BenchmarkSliceState, DatasetSliceState {
  // ...
}

export const initialState: EvalStoreState = {
  ...benchmarkInitialState,
  ...datasetInitialState, // Add here
  ...runInitialState,
};
```

#### Step 4: Create Selectors (Optional but Recommended)

```typescript
// src/store/eval/slices/dataset/selectors.ts
import type { EvalStore } from '@/store/eval/store';

export const datasetSelectors = {
  getDatasetData: (benchmarkId: string) => (s: EvalStore) => s.datasetMap[benchmarkId],

  getDatasets: (benchmarkId: string) => (s: EvalStore) => s.datasetMap[benchmarkId]?.items ?? [],

  isLoadingDataset: (id: string) => (s: EvalStore) => s.loadingDatasetIds.includes(id),
};
```

#### Step 5: Use in Component

```typescript
// Component - List with Map
import { useEvalStore } from '@/store/eval';
import { datasetSelectors } from '@/store/eval/selectors';

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

// Component - Single item (for modal)
const DatasetImportModal = ({ open, datasetId }: Props) => {
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const dataset = useEvalStore((s) => s.datasetDetail);
  const isLoading = useEvalStore((s) => s.isLoadingDatasetDetail);

  // Only fetch when modal is open
  useFetchDatasetDetail(open && datasetId ? datasetId : undefined);

  return (
    <Modal open={open}>
      {isLoading ? <Loading /> : <div>{dataset?.name}</div>}
    </Modal>
  );
};
```

---

## Common Patterns

### Pattern 1: List + Detail

```typescript
// List with pagination
useFetchTestCases: (params) => {
  const { datasetId, limit, offset } = params;
  return useClientDataSWR(
    datasetId ? [FETCH_TEST_CASES_KEY, datasetId, limit, offset] : null,
    () => agentEvalService.listTestCases({ datasetId, limit, offset }),
    {
      onSuccess: (data: any) => {
        set(
          {
            testCaseList: data.data,
            testCaseTotal: data.total,
            isLoadingTestCases: false,
          },
          false,
          'useFetchTestCases/success',
        );
      },
    },
  );
};
```

### Pattern 2: Dependent Fetching

```typescript
// Component
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams();

  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const benchmark = useEvalStore((s) => s.benchmarkDetail);

  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);
  const datasets = useEvalStore((s) => s.datasetList);

  // Fetch benchmark first
  useFetchBenchmarkDetail(benchmarkId);

  // Then fetch datasets for this benchmark
  useFetchDatasets(benchmarkId);

  return <div>...</div>;
};
```

### Pattern 3: Conditional Fetching

```typescript
// Only fetch when modal is open
const DatasetImportModal = ({ open, datasetId }: Props) => {
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const dataset = useEvalStore((s) => s.datasetDetail);

  // Only fetch when open AND datasetId exists
  useFetchDatasetDetail(open && datasetId ? datasetId : undefined);

  return <Modal open={open}>...</Modal>;
};
```

### Pattern 4: Refresh After Mutation

```typescript
// Store action
createDataset: async (params) => {
  const result = await agentEvalService.createDataset(params);
  // Refresh the list after creation
  await get().refreshDatasets(params.benchmarkId);
  return result;
};

deleteDataset: async (id, benchmarkId) => {
  await agentEvalService.deleteDataset(id);
  // Refresh the list after deletion
  await get().refreshDatasets(benchmarkId);
};
```

---

## Migration Guide: useEffect → Store SWR

### Before (❌ Wrong)

```typescript
const TestCaseList = ({ datasetId }: Props) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const result = await lambdaClient.agentEval.listTestCases.query({
          datasetId,
        });
        setData(result.data);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [datasetId]);

  return <Table data={data} loading={loading} />;
};
```

### After (✅ Correct)

```typescript
// 1. Create service method
class AgentEvalService {
  async listTestCases(params: { datasetId: string }) {
    return lambdaClient.agentEval.listTestCases.query(params);
  }
}

// 2. Create store slice
export const createTestCaseSlice: StateCreator<...> = (set) => ({
  useFetchTestCases: (params) => {
    return useClientDataSWR(
      params.datasetId ? [FETCH_TEST_CASES_KEY, params.datasetId] : null,
      () => agentEvalService.listTestCases(params),
      {
        onSuccess: (data: any) => {
          set(
            { testCaseList: data.data, isLoadingTestCases: false },
            false,
            'useFetchTestCases/success',
          );
        },
      },
    );
  },
});

// 3. Use in component
const TestCaseList = ({ datasetId }: Props) => {
  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
  const data = useEvalStore((s) => s.testCaseList);
  const loading = useEvalStore((s) => s.isLoadingTestCases);

  useFetchTestCases({ datasetId });

  return <Table data={data} loading={loading} />;
};
```

---

## Best Practices

### ✅ DO

1. **Always use service layer** - Never call lambdaClient directly in stores/components
2. **Use SWR hooks in stores** - Not useEffect in components
3. **Clear naming** - `useFetchXxx` for hooks, `refreshXxx` for cache invalidation
4. **Proper cache keys** - Use constants, include parameters in array form
5. **Update state in onSuccess** - Set loading states and data
6. **Refresh after mutations** - Call refresh methods after create/update/delete
7. **Handle loading states** - Provide loading indicators to users

### ❌ DON'T

1. **Don't use useEffect** for data fetching
2. **Don't use useState** for server data
3. **Don't call lambdaClient** directly in components or stores
4. **Don't forget to refresh** cache after mutations
5. **Don't duplicate state** - Use store as single source of truth

---

## Troubleshooting

### Problem: Data not loading

**Check:**

1. Is the hook being called? `useFetchXxx()`
2. Is the key valid? (not null/undefined)
3. Is the service method correct?
4. Check browser network tab for API calls

### Problem: Data not refreshing after mutation

**Check:**

1. Did you call `refreshXxx()` after mutation?
2. Is the cache key the same in both hook and refresh?
3. Check devtools for state updates

### Problem: Loading state stuck

**Check:**

1. Is `onSuccess` updating `isLoadingXxx: false`?
2. Is there an error in the API call?
3. Check error boundary or console

---

## Summary Checklist

When implementing new data fetching:

### Step 1: Data Structures

> See `store-data-structures` skill for detailed patterns

- [ ] **Define types** in `@lobechat/types`:
  - [ ] Detail type (e.g., `AgentEvalBenchmark`)
  - [ ] List item type (e.g., `AgentEvalBenchmarkListItem`)
- [ ] **Design state structure**:
  - [ ] List: `xxxList: XxxListItem[]`
  - [ ] Detail: `xxxDetailMap: Record<string, Xxx>`
  - [ ] Loading: `loadingXxxDetailIds: string[]`
- [ ] **Create reducer** if optimistic updates needed

### Step 2: Service Layer

- [ ] Create service in `src/services/xxxService.ts`
- [ ] Add methods:
  - [ ] `listXxx()` - fetch list
  - [ ] `getXxx(id)` - fetch detail
  - [ ] `createXxx()`, `updateXxx()`, `deleteXxx()` - mutations

### Step 3: Store Actions

- [ ] Create `initialState.ts` with state structure
- [ ] Create `action.ts` with:
  - [ ] `useFetchXxxList()` - list SWR hook
  - [ ] `useFetchXxxDetail(id)` - detail SWR hook
  - [ ] `refreshXxxList()`, `refreshXxxDetail(id)` - cache invalidation
  - [ ] CRUD methods calling service
  - [ ] `internal_dispatch` and `internal_updateLoading` if using reducer
- [ ] Create `selectors.ts` (optional but recommended)
- [ ] Integrate slice into main store

### Step 4: Component Usage

- [ ] Use store hooks (NOT useEffect)
- [ ] List pages: access `xxxList` array
- [ ] Detail pages: access `xxxDetailMap[id]`
- [ ] Use loading states for UI feedback

Remember: **Types → Service → Store (SWR + Reducer) → Component** 🎯

## Key Architecture Patterns

1. **Service Layer**: Clean API abstraction (`xxxService`)
2. **Data Structures**: List arrays + Detail maps (see `store-data-structures` skill)
3. **SWR Hooks**: Automatic caching and revalidation (`useFetchXxx`)
4. **Cache Invalidation**: Manual refresh methods (`refreshXxx`)
5. **Optimistic Updates**: Update UI immediately, then sync with server
6. **Loading States**: Per-item loading for better UX

---

## Related Skills

- **`store-data-structures`** - How to structure List and Detail data in stores
- **`zustand`** - General Zustand patterns and best practices
