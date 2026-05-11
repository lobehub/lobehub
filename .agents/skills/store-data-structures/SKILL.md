---
name: store-data-structures
description: Zustand store data structure patterns for LobeHub. Covers List vs Detail data structures, Map + Reducer patterns, type definitions, and when to use each pattern. Use when designing store state, choosing data structures, or implementing list/detail pages.
user-invocable: false
---

# LobeHub Store Data Structures

How to structure data in Zustand stores for fast list rendering, multi-detail caching, and ergonomic optimistic updates.

## Core Principles

### ✅ DO

1. **Separate List and Detail** — different structures for list pages and detail pages
2. **Use Map for Details** — cache multiple detail pages with `Record<string, Detail>`
3. **Use Array for Lists** — simple arrays for list display
4. **Types from `@lobechat/types`** — never use `@lobechat/database` types in stores
5. **Distinguish List and Detail types** — List types may have computed UI fields

### ❌ DON'T

1. **Don't use a single detail object** — can't cache multiple pages
2. **Don't mix List and Detail types** — they have different purposes
3. **Don't use database types** — use types from `@lobechat/types`
4. **Don't use Map for lists** — simple arrays are sufficient

---

## Type Definitions

Each entity gets its own file under `@lobechat/types/`. Each file exports two types:

- **Detail type** — full entity, including heavy fields (rubrics, content, editor state, …)
- **List item type** — a **subset** that excludes heavy fields, may add computed UI fields (counts, timestamps formatted for display)

**Important:** the List type is a **subset**, not an `extends` of Detail. Extending pulls the heavy fields right back in.

> See [`references/types.md`](./references/types.md) for full worked examples (Benchmark, Document) and the heavy-field exclusion checklist.

---

## When to Use Map vs Array

### Use Map + Reducer — for Detail Data

✅ Detail page data caching — multiple detail pages cached simultaneously
✅ Optimistic updates — update UI before API responds
✅ Per-item loading states — track which items are being updated
✅ Multi-page navigation — user can switch between details without refetching

```typescript
benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
```

Examples: benchmark detail pages, dataset detail pages, user profiles.

### Use Simple Array — for List Data

✅ List display — lists, tables, cards
✅ Refresh as a whole — entire list refreshes together
✅ No per-item updates — no need to mutate individual rows in place
✅ Simple data flow — fewer moving parts

```typescript
benchmarkList: AgentEvalBenchmarkListItem[];
```

Examples: benchmark list, dataset list, user list.

---

## State Structure Pattern

```typescript
// src/store/eval/slices/benchmark/initialState.ts
import type { AgentEvalBenchmark, AgentEvalBenchmarkListItem } from '@lobechat/types';

export interface BenchmarkSliceState {
  // List — simple array
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  // Detail — map for multi-entity caching
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
  loadingBenchmarkDetailIds: string[]; // per-item loading

  // Mutation states (drive form-level UI)
  isCreatingBenchmark: boolean;
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}

export const benchmarkInitialState: BenchmarkSliceState = {
  benchmarkList: [],
  benchmarkListInit: false,
  benchmarkDetailMap: {},
  loadingBenchmarkDetailIds: [],
  isCreatingBenchmark: false,
  isUpdatingBenchmark: false,
  isDeletingBenchmark: false,
};
```

---

## Reducer Pattern (for Detail Map)

When the Detail Map needs optimistic updates (i.e. the user edits a row and the UI should reflect it before the server confirms), wire a typed reducer instead of inlining `set` calls. This keeps mutations testable and the dispatch surface small.

> See [`references/reducer.md`](./references/reducer.md) for the full discriminated-union action types, the `produce`-based reducer, and the `internal_dispatch*` slice methods that connect them to Zustand.

---

## Data Structure Comparison

### ❌ WRONG — Single Detail Object

```typescript
interface BenchmarkSliceState {
  benchmarkDetail: AgentEvalBenchmark | null;
  isLoadingBenchmarkDetail: boolean;
}
```

Problems:

- Can only cache one detail page at a time
- Switching between details forces refetch
- No optimistic updates
- No per-item loading states

### ✅ CORRECT — Separate List and Detail

```typescript
interface BenchmarkSliceState {
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
  loadingBenchmarkDetailIds: string[];

  isCreatingBenchmark: boolean;
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}
```

Benefits:

- Cache multiple detail pages
- Fast navigation between cached details
- Optimistic updates via reducer
- Per-item loading states
- Clear separation of concerns

---

## Component Usage

### Accessing List Data

```tsx
const BenchmarkList = () => {
  const benchmarks = useEvalStore((s) => s.benchmarkList);
  const isInit = useEvalStore((s) => s.benchmarkListInit);

  if (!isInit) return <Loading />;
  return (
    <div>
      {benchmarks.map((b) => (
        <BenchmarkCard key={b.id} name={b.name} testCaseCount={b.testCaseCount} />
      ))}
    </div>
  );
};
```

### Accessing Detail Data

```tsx
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams<{ benchmarkId: string }>();

  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );
  const isLoading = useEvalStore((s) =>
    benchmarkId ? s.loadingBenchmarkDetailIds.includes(benchmarkId) : false,
  );

  if (!benchmark) return <Loading />;
  return (
    <div>
      <h1>{benchmark.name}</h1>
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

// In component
const benchmark = useEvalStore(benchmarkSelectors.getBenchmarkDetail(benchmarkId!));
const isLoading = useEvalStore(benchmarkSelectors.isLoadingBenchmarkDetail(benchmarkId!));
```

---

## Decision Tree

```text
Need to store data?
│
├─ Is it a LIST for display?
│  └─ ✅ Use simple array: `xxxList: XxxListItem[]`
│     - May include computed fields
│     - Refreshed as a whole
│     - No optimistic updates needed
│
└─ Is it DETAIL page data?
   └─ ✅ Use Map: `xxxDetailMap: Record<string, Xxx>`
      - Cache multiple details
      - Support optimistic updates
      - Per-item loading states
      - Requires reducer for mutations
```

---

## Checklist

When designing store state structure:

- [ ] **Organize types by entity** in separate files (e.g. `benchmark.ts`, `agentEvalDataset.ts`)
- [ ] Create **Detail** type (full entity with all fields including heavy ones)
- [ ] Create **ListItem** type:
  - [ ] Subset of Detail (exclude heavy fields)
  - [ ] May include computed statistics for UI
  - [ ] **NOT** `extends` Detail
- [ ] Use **array** for list data: `xxxList: XxxListItem[]`
- [ ] Use **Map** for detail data: `xxxDetailMap: Record<string, Xxx>`
- [ ] Per-item loading: `loadingXxxDetailIds: string[]`
- [ ] **Reducer** for detail map if optimistic updates needed (see [`references/reducer.md`](./references/reducer.md))
- [ ] **Internal dispatch** and **loading** methods
- [ ] **Selectors** for clean access (optional but recommended)
- [ ] Document in comments which fields are excluded from List and why

---

## Best Practices

1. **File organization** — one entity per file, not mixed
2. **List is a subset** — ListItem excludes heavy fields, does not `extends` Detail
3. **Clear naming** — `xxxList` for arrays, `xxxDetailMap` for maps
4. **Consistent patterns** — all detail maps follow the same shape
5. **Type safety** — never use `any`, always use proper types
6. **Document exclusions** — comment which fields are excluded and why
7. **Selectors** — encapsulate access patterns
8. **Loading states** — per-item for details, global for mutations
9. **Immutability** — use Immer in reducers

### Common Mistakes to Avoid

❌ **DON'T extend Detail in List:**

```typescript
// Wrong — pulls heavy fields back in
export interface BenchmarkListItem extends Benchmark {
  testCaseCount?: number;
}
```

✅ **DO create separate subset:**

```typescript
export interface BenchmarkListItem {
  id: string;
  name: string;
  // ... only necessary fields
  testCaseCount?: number; // Computed
}
```

❌ **DON'T mix entities in one file:**

```text
// Wrong — all entities in agentEvalEntities.ts
```

✅ **DO separate by entity:**

```text
// Correct — separate files
// benchmark.ts
// agentEvalDataset.ts
// agentEvalRun.ts
```

---

## Related Skills

- `data-fetching` — how to fetch and update this data
- `zustand` — general Zustand patterns
