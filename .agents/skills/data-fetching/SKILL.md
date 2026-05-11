---
name: data-fetching
description: Data fetching architecture guide using Service layer + Zustand Store + SWR. Use when implementing data fetching, creating services, working with store hooks, or migrating from useEffect. Triggers on data loading, API calls, service creation, or store data fetching tasks.
user-invocable: false
---

# LobeHub Data Fetching Architecture

> **Related:** `store-data-structures` covers List vs Detail data shape rationale (Map vs Array).

## Architecture Overview

```text
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
3. **Use proper data structures** — see `store-data-structures` skill for List vs Detail patterns
4. **Use lambdaClient.mutate** for write operations (create/update/delete)
5. **Use lambdaClient.query** only inside service methods
6. **Naming convention** — read hooks are `useFetchXxx`, cache invalidation helpers are `refreshXxx` (e.g. `useFetchBenchmarks` / `refreshBenchmarks`). Mutations then chain `refreshXxx()` after the service call.

### ❌ DON'T

1. **Never use useEffect** for data fetching
2. **Never call lambdaClient** directly in components or stores
3. **Never use useState** for server data
4. **Never mix data structure patterns** — follow `store-data-structures` skill

---

## Layer 1: Service Layer

### Purpose

- Encapsulate all API calls to lambdaClient
- Provide clean, typed interfaces
- Single source of truth for API operations

### Service Structure

```typescript
// src/services/agentEval.ts
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

### State Structure

```typescript
// src/store/eval/slices/benchmark/initialState.ts
export interface BenchmarkSliceState {
  // List data - simple array
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  // Detail data - map for caching
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
  loadingBenchmarkDetailIds: string[];

  // Mutation states
  isCreatingBenchmark: boolean;
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}
```

> For complete initialState, reducer, and internal dispatch patterns, see the `store-data-structures` skill.

### Actions

```typescript
// src/store/eval/slices/benchmark/action.ts
const FETCH_BENCHMARKS_KEY = 'FETCH_BENCHMARKS';
const FETCH_BENCHMARK_DETAIL_KEY = 'FETCH_BENCHMARK_DETAIL';

export interface BenchmarkAction {
  // SWR Hooks - for data fetching
  useFetchBenchmarks: () => SWRResponse;
  useFetchBenchmarkDetail: (id?: string) => SWRResponse;

  // Refresh methods - for cache invalidation
  refreshBenchmarks: () => Promise<void>;
  refreshBenchmarkDetail: (id: string) => Promise<void>;

  // Mutation actions
  createBenchmark: (params: CreateParams) => Promise<any>;
  updateBenchmark: (params: UpdateParams) => Promise<void>;
  deleteBenchmark: (id: string) => Promise<void>;

  // Internal methods - not for direct UI use
  internal_dispatchBenchmarkDetail: (payload: BenchmarkDetailDispatch) => void;
  internal_updateBenchmarkDetailLoading: (id: string, loading: boolean) => void;
}

export const createBenchmarkSlice: StateCreator<EvalStore, any, [], BenchmarkAction> = (
  set,
  get,
) => ({
  // Fetch list — simple array stored in benchmarkList
  useFetchBenchmarks: () =>
    useClientDataSWR(FETCH_BENCHMARKS_KEY, () => agentEvalService.listBenchmarks(), {
      onSuccess: (data) => {
        set({ benchmarkList: data, benchmarkListInit: true }, false, 'useFetchBenchmarks/success');
      },
    }),

  // Fetch detail — null key disables the request when id is missing
  useFetchBenchmarkDetail: (id) =>
    useClientDataSWR(
      id ? [FETCH_BENCHMARK_DETAIL_KEY, id] : null,
      () => agentEvalService.getBenchmark(id!),
      {
        onSuccess: (data) => {
          get().internal_dispatchBenchmarkDetail({
            type: 'setBenchmarkDetail',
            id: id!,
            value: data,
          });
          get().internal_updateBenchmarkDetailLoading(id!, false);
        },
      },
    ),

  // Refresh methods
  refreshBenchmarks: () => mutate(FETCH_BENCHMARKS_KEY),
  refreshBenchmarkDetail: (id) => mutate([FETCH_BENCHMARK_DETAIL_KEY, id]),

  // CREATE — refresh list after creation
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

  // UPDATE — optimistic update + refresh
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

  // DELETE — optimistic update + refresh
  deleteBenchmark: async (id) => {
    get().internal_dispatchBenchmarkDetail({ type: 'deleteBenchmarkDetail', id });
    get().internal_updateBenchmarkDetailLoading(id, true);

    try {
      await agentEvalService.deleteBenchmark(id);
      await get().refreshBenchmarks();
    } finally {
      get().internal_updateBenchmarkDetailLoading(id, false);
    }
  },

  // Internal — dispatch to reducer (for detail map)
  internal_dispatchBenchmarkDetail: (payload) => {
    const currentMap = get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    // Skip set when nothing changed — avoids unnecessary re-renders
    if (isEqual(nextMap, currentMap)) return;
    set({ benchmarkDetailMap: nextMap }, false, `dispatchBenchmarkDetail/${payload.type}`);
  },

  // Internal — update loading state for specific detail
  internal_updateBenchmarkDetailLoading: (id, loading) => {
    set(
      (state) => ({
        loadingBenchmarkDetailIds: loading
          ? [...state.loadingBenchmarkDetailIds, id]
          : state.loadingBenchmarkDetailIds.filter((i) => i !== id),
      }),
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

### Fetching List Data

```tsx
// ✅ CORRECT
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
      {benchmarks.map((b) => (
        <BenchmarkCard key={b.id} {...b} />
      ))}
    </div>
  );
};
```

### Fetching Detail Data

```tsx
// ✅ CORRECT
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams<{ benchmarkId: string }>();

  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);

  // Detail from map
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );

  // Per-item loading
  const isLoading = useEvalStore((s) =>
    benchmarkId ? s.loadingBenchmarkDetailIds.includes(benchmarkId) : false,
  );

  useFetchBenchmarkDetail(benchmarkId);

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

### Using Selectors (Recommended)

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

### Anti-pattern

```tsx
// ❌ WRONG — Don't use useEffect for data fetching
const BenchmarkList = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    lambdaClient.agentEval.listBenchmarks
      .query()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return <div>...</div>;
};
```

### Mutations in Components

```tsx
// Create — global mutation flag drives form loading
const CreateBenchmarkModal = () => {
  const createBenchmark = useEvalStore((s) => s.createBenchmark);
  const isCreating = useEvalStore((s) => s.isCreatingBenchmark);

  const handleSubmit = async (values) => {
    try {
      // Optimistic update + refresh happen inside createBenchmark
      await createBenchmark(values);
      message.success('Created successfully');
      onClose();
    } catch (error) {
      message.error('Failed to create');
    }
  };

  return (
    <Form onSubmit={handleSubmit} loading={isCreating}>
      ...
    </Form>
  );
};

// Update / delete — per-item loading so only the row being mutated spins
const BenchmarkItem = ({ id }: { id: string }) => {
  const updateBenchmark = useEvalStore((s) => s.updateBenchmark);
  const deleteBenchmark = useEvalStore((s) => s.deleteBenchmark);
  const isLoading = useEvalStore(benchmarkSelectors.isLoadingBenchmarkDetail(id));

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

**Why two patterns:** create has no id yet, so a single `isCreatingXxx` flag is enough. Update/delete target a specific row, so global flags would freeze unrelated rows — keep per-item state in `loadingXxxIds`.

---

## Need a fuller worked example?

The canonical `Benchmark` example above is the one to copy for a flat list + detail map. If you need to maintain a list **keyed by a parent id** (e.g. `datasetMap[benchmarkId]` because the same shape appears under multiple parents), read [`references/walkthrough.md`](./references/walkthrough.md) — it walks through the full 6 steps (service → reducer → slice → store wiring → selectors → component) for that variant.

---

## Common Patterns

### Pattern 1: Pagination

Cache key array must include every parameter that should trigger a refetch.

```typescript
useFetchTestCases: (params: { datasetId: string; limit: number; offset: number }) =>
  useClientDataSWR(
    params.datasetId ? [FETCH_TEST_CASES_KEY, params.datasetId, params.limit, params.offset] : null,
    () => agentEvalService.listTestCases(params),
    {
      onSuccess: (data) =>
        set({
          testCaseList: data.data,
          testCaseTotal: data.total,
          isLoadingTestCases: false,
        }),
    },
  );
```

### Pattern 2: Dependent Fetching

Both hooks run in parallel — SWR dedupes, no manual sequencing needed.

```tsx
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams();
  const useFetchBenchmarkDetail = useEvalStore((s) => s.useFetchBenchmarkDetail);
  const useFetchDatasets = useEvalStore((s) => s.useFetchDatasets);

  useFetchBenchmarkDetail(benchmarkId);
  useFetchDatasets(benchmarkId);

  return <div>...</div>;
};
```

### Pattern 3: Conditional Fetching

Pass `undefined` to disable the hook entirely.

```tsx
// only fetch when modal is open AND id present
useFetchDatasetDetail(open && datasetId ? datasetId : undefined);
```

### Pattern 4: Cross-domain Refresh

```typescript
deleteBenchmark: async (id) => {
  await agentEvalService.deleteBenchmark(id);
  await get().refreshBenchmarks();
  await get().refreshDatasets(id); // related cache invalidated too
};
```

---

## Migration Guide: useEffect → Store SWR

### Before (❌ Wrong)

```tsx
const TestCaseList = ({ datasetId }: Props) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    lambdaClient.agentEval.listTestCases
      .query({ datasetId })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [datasetId]);

  return <Table data={data} loading={loading} />;
};
```

### After (✅ Correct)

```typescript
// 1. Add service method
class AgentEvalService {
  async listTestCases(params: { datasetId: string }) {
    return lambdaClient.agentEval.listTestCases.query(params);
  }
}

// 2. Add store slice hook
export const createTestCaseSlice: StateCreator<...> = (set) => ({
  useFetchTestCases: (params) =>
    useClientDataSWR(
      params.datasetId ? [FETCH_TEST_CASES_KEY, params.datasetId] : null,
      () => agentEvalService.listTestCases(params),
      {
        onSuccess: (data) =>
          set({ testCaseList: data.data, isLoadingTestCases: false }),
      },
    ),
});

// 3. Component reads from store
const TestCaseList = ({ datasetId }: Props) => {
  const useFetchTestCases = useEvalStore((s) => s.useFetchTestCases);
  const data = useEvalStore((s) => s.testCaseList);
  const loading = useEvalStore((s) => s.isLoadingTestCases);

  useFetchTestCases({ datasetId });

  return <Table data={data} loading={loading} />;
};
```

---

## Troubleshooting

| Symptom                     | Check                                                               |
| --------------------------- | ------------------------------------------------------------------- |
| Data never loads            | Hook called? Key not `null`/`undefined`? Network tab shows request? |
| Stale data after mutation   | Did `refreshXxx` run? Cache key matches what the hook uses?         |
| Loading state stuck `true`  | `onSuccess` writes loading=false? Promise rejected silently?        |
| Detail map missing an entry | Reducer dispatch ran? `isEqual` short-circuited on stale data?      |

---

## Summary Checklist

When adding new data fetching:

### Step 1: Types & State

See `store-data-structures` for details.

- [ ] Define types in `@lobechat/types`: Detail type + List item type
- [ ] State structure: `xxxList: XxxListItem[]`, `xxxDetailMap: Record<string, Xxx>`, `loadingXxxDetailIds: string[]`
- [ ] Reducer if optimistic updates are needed

### Step 2: Service Layer

- [ ] Create service in `src/services/xxxService.ts`
- [ ] Methods: `listXxx()`, `getXxx(id)`, `createXxx()`, `updateXxx()`, `deleteXxx()`

### Step 3: Store Actions

- [ ] `initialState.ts` with state structure
- [ ] `action.ts` with:
  - [ ] `useFetchXxxList()`, `useFetchXxxDetail(id)` — SWR hooks
  - [ ] `refreshXxxList()`, `refreshXxxDetail(id)` — cache invalidation
  - [ ] CRUD methods calling service
  - [ ] `internal_dispatch`, `internal_updateLoading` if using reducer
- [ ] `selectors.ts` (optional but recommended)
- [ ] Integrate slice into main store + initialState

### Step 4: Component Usage

- [ ] Use store hooks (NOT useEffect)
- [ ] List pages: access `xxxList` array
- [ ] Detail pages: access `xxxDetailMap[id]`
- [ ] Use loading states for UI feedback

**Mental model:** Types → Service → Reducer → Slice → Component 🎯

---

## Related Skills

- **`store-data-structures`** — How to structure List and Detail data in stores
- **`zustand`** — General Zustand patterns and best practices
