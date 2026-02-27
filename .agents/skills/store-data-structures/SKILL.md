---
name: store-data-structures
description: Zustand store data structure patterns for LobeHub. Covers List vs Detail data structures, Map + Reducer patterns, type definitions, and when to use each pattern. Use when designing store state, choosing data structures, or implementing list/detail pages.
---

# LobeHub Store Data Structures

This guide covers how to structure data in Zustand stores for optimal performance and user experience.

## Core Principles

### ✅ DO

1. **Separate List and Detail** - Use different structures for list pages and detail pages
2. **Use Map for Details** - Cache multiple detail pages with `Record<string, Detail>`
3. **Use Array for Lists** - Simple arrays for list display
4. **Types from @lobechat/types** - Never use `@lobechat/database` types in stores
5. **Distinguish List and Detail types** - List types may have computed UI fields

### ❌ DON'T

1. **Don't use single detail object** - Can't cache multiple pages
2. **Don't mix List and Detail types** - They have different purposes
3. **Don't use database types** - Use types from `@lobechat/types`
4. **Don't use Map for lists** - Simple arrays are sufficient

---

## Type Definitions

Types should be organized by entity in separate files:

```
@lobechat/types/src/eval/
├── benchmark.ts        # Benchmark types
├── agentEvalDataset.ts # Dataset types
├── agentEvalRun.ts     # Run types
└── index.ts           # Re-exports
```

### Example: Benchmark Types

```typescript
// packages/types/src/eval/benchmark.ts
import type { EvalBenchmarkRubric } from './rubric';

// ============================================
// Detail Type - Full entity (for detail pages)
// ============================================

/**
 * Full benchmark entity with all fields including heavy data
 */
export interface AgentEvalBenchmark {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;
  metadata?: Record<string, unknown> | null;
  name: string;
  referenceUrl?: string | null;
  rubrics: EvalBenchmarkRubric[]; // Heavy field
  updatedAt: Date;
}

// ============================================
// List Type - Lightweight (for list display)
// ============================================

/**
 * Lightweight benchmark item - excludes heavy fields
 * May include computed statistics for UI
 */
export interface AgentEvalBenchmarkListItem {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;
  name: string;
  // Note: rubrics NOT included (heavy field)

  // Computed statistics for UI display
  datasetCount?: number;
  runCount?: number;
  testCaseCount?: number;
}
```

### Example: Document Types (with heavy content)

```typescript
// packages/types/src/document.ts

/**
 * Full document entity - includes heavy content fields
 */
export interface Document {
  id: string;
  title: string;
  description?: string;
  content: string; // Heavy field - full markdown content
  editorData: any; // Heavy field - editor state
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lightweight document item - excludes heavy content
 */
export interface DocumentListItem {
  id: string;
  title: string;
  description?: string;
  // Note: content and editorData NOT included
  createdAt: Date;
  updatedAt: Date;

  // Computed statistics
  wordCount?: number;
  lastEditedBy?: string;
}
```

**Key Points:**

- **Detail types** include ALL fields from database (full entity)
- **List types** are **subsets** that exclude heavy/large fields
- List types may add computed statistics for UI (e.g., `testCaseCount`)
- **Each entity gets its own file** (not mixed together)
- **All types** exported from `@lobechat/types`, NOT `@lobechat/database`

**Heavy fields to exclude from List:**

- Large text content (`content`, `editorData`, `fullDescription`)
- Complex objects (`rubrics`, `config`, `metrics`)
- Binary data (`image`, `file`)
- Large arrays (`messages`, `items`)

---

## When to Use Map vs Array

### Use Map + Reducer (for Detail Data)

✅ **Detail page data caching** - Cache multiple detail pages simultaneously
✅ **Optimistic updates** - Update UI before API responds
✅ **Per-item loading states** - Track which items are being updated
✅ **Multiple pages open** - User can navigate between details without refetching

**Structure:**

```typescript
benchmarkDetailMap: Record<string, AgentEvalBenchmark>;
```

**Example:** Benchmark detail pages, Dataset detail pages, User profiles

### Use Simple Array (for List Data)

✅ **List display** - Lists, tables, cards
✅ **Read-only or refresh-as-whole** - Entire list refreshes together
✅ **No per-item updates** - No need to update individual items
✅ **Simple data flow** - Easier to understand and maintain

**Structure:**

```typescript
benchmarkList: AgentEvalBenchmarkListItem[]
```

**Example:** Benchmark list, Dataset list, User list

---

## State Structure Pattern

### Complete Example

```typescript
// packages/types/src/eval/benchmark.ts
import type { EvalBenchmarkRubric } from './rubric';

/**
 * Full benchmark entity (for detail pages)
 */
export interface AgentEvalBenchmark {
  id: string;
  name: string;
  description?: string | null;
  identifier: string;
  rubrics: EvalBenchmarkRubric[]; // Heavy field
  metadata?: Record<string, unknown> | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lightweight benchmark (for list display)
 * Excludes heavy fields like rubrics
 */
export interface AgentEvalBenchmarkListItem {
  id: string;
  name: string;
  description?: string | null;
  identifier: string;
  isSystem: boolean;
  createdAt: Date;
  // Note: rubrics excluded

  // Computed statistics
  testCaseCount?: number;
  datasetCount?: number;
  runCount?: number;
}
```

```typescript
// src/store/eval/slices/benchmark/initialState.ts
import type { AgentEvalBenchmark, AgentEvalBenchmarkListItem } from '@lobechat/types';

export interface BenchmarkSliceState {
  // ============================================
  // List Data - Simple Array
  // ============================================
  /**
   * List of benchmarks for list page display
   * May include computed fields like testCaseCount
   */
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  // ============================================
  // Detail Data - Map for Caching
  // ============================================
  /**
   * Map of benchmark details keyed by ID
   * Caches detail page data for multiple benchmarks
   * Enables optimistic updates and per-item loading
   */
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;

  /**
   * Track which benchmark details are being loaded/updated
   * For showing spinners on specific items
   */
  loadingBenchmarkDetailIds: string[];

  // ============================================
  // Mutation States
  // ============================================
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

### Why Use Reducer?

- **Immutable updates** - Immer ensures immutability
- **Type-safe actions** - TypeScript discriminated unions
- **Testable** - Pure functions easy to test
- **Reusable** - Same reducer for optimistic updates and server data

### Reducer Structure

```typescript
// src/store/eval/slices/benchmark/reducer.ts
import { produce } from 'immer';
import type { AgentEvalBenchmark } from '@lobechat/types';

// ============================================
// Action Types
// ============================================

type SetBenchmarkDetailAction = {
  id: string;
  type: 'setBenchmarkDetail';
  value: AgentEvalBenchmark;
};

type UpdateBenchmarkDetailAction = {
  id: string;
  type: 'updateBenchmarkDetail';
  value: Partial<AgentEvalBenchmark>;
};

type DeleteBenchmarkDetailAction = {
  id: string;
  type: 'deleteBenchmarkDetail';
};

export type BenchmarkDetailDispatch =
  | SetBenchmarkDetailAction
  | UpdateBenchmarkDetailAction
  | DeleteBenchmarkDetailAction;

// ============================================
// Reducer Function
// ============================================

export const benchmarkDetailReducer = (
  state: Record<string, AgentEvalBenchmark> = {},
  payload: BenchmarkDetailDispatch,
): Record<string, AgentEvalBenchmark> => {
  switch (payload.type) {
    case 'setBenchmarkDetail': {
      return produce(state, (draft) => {
        draft[payload.id] = payload.value;
      });
    }

    case 'updateBenchmarkDetail': {
      return produce(state, (draft) => {
        if (draft[payload.id]) {
          draft[payload.id] = { ...draft[payload.id], ...payload.value };
        }
      });
    }

    case 'deleteBenchmarkDetail': {
      return produce(state, (draft) => {
        delete draft[payload.id];
      });
    }

    default:
      return state;
  }
};
```

### Internal Dispatch Methods

```typescript
// In action.ts
export interface BenchmarkAction {
  // ... other methods ...

  // Internal methods - not for direct UI use
  internal_dispatchBenchmarkDetail: (payload: BenchmarkDetailDispatch) => void;
  internal_updateBenchmarkDetailLoading: (id: string, loading: boolean) => void;
}

export const createBenchmarkSlice: StateCreator<...> = (set, get) => ({
  // ... other methods ...

  // Internal - Dispatch to reducer
  internal_dispatchBenchmarkDetail: (payload) => {
    const currentMap = get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    // Only update if changed
    if (isEqual(nextMap, currentMap)) return;

    set(
      { benchmarkDetailMap: nextMap },
      false,
      `dispatchBenchmarkDetail/${payload.type}`,
    );
  },

  // Internal - Update loading state
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

---

## Data Structure Comparison

### ❌ WRONG - Single Detail Object

```typescript
interface BenchmarkSliceState {
  // ❌ Can only cache one detail
  benchmarkDetail: AgentEvalBenchmark | null;

  // ❌ Global loading state
  isLoadingBenchmarkDetail: boolean;
}
```

**Problems:**

- Can only cache one detail page at a time
- Switching between details causes unnecessary refetches
- No optimistic updates
- No per-item loading states

### ✅ CORRECT - Separate List and Detail

```typescript
import type { AgentEvalBenchmark, AgentEvalBenchmarkListItem } from '@lobechat/types';

interface BenchmarkSliceState {
  // ✅ List data - simple array
  benchmarkList: AgentEvalBenchmarkListItem[];
  benchmarkListInit: boolean;

  // ✅ Detail data - map for caching
  benchmarkDetailMap: Record<string, AgentEvalBenchmark>;

  // ✅ Per-item loading
  loadingBenchmarkDetailIds: string[];

  // ✅ Mutation states
  isCreatingBenchmark: boolean;
  isUpdatingBenchmark: boolean;
  isDeletingBenchmark: boolean;
}
```

**Benefits:**

- Cache multiple detail pages
- Fast navigation between cached details
- Optimistic updates with reducer
- Per-item loading states
- Clear separation of concerns

---

## Component Usage

### Accessing List Data

```typescript
const BenchmarkList = () => {
  // Simple array access
  const benchmarks = useEvalStore((s) => s.benchmarkList);
  const isInit = useEvalStore((s) => s.benchmarkListInit);

  if (!isInit) return <Loading />;

  return (
    <div>
      {benchmarks.map(b => (
        <BenchmarkCard
          key={b.id}
          name={b.name}
          testCaseCount={b.testCaseCount} // Computed field
        />
      ))}
    </div>
  );
};
```

### Accessing Detail Data

```typescript
const BenchmarkDetail = () => {
  const { benchmarkId } = useParams<{ benchmarkId: string }>();

  // Get from map
  const benchmark = useEvalStore((s) =>
    benchmarkId ? s.benchmarkDetailMap[benchmarkId] : undefined,
  );

  // Check loading
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

```
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

- [ ] **Organize types by entity** in separate files (e.g., `benchmark.ts`, `agentEvalDataset.ts`)
- [ ] Create **Detail** type (full entity with all fields including heavy ones)
- [ ] Create **ListItem** type:
  - [ ] Subset of Detail type (exclude heavy fields)
  - [ ] May include computed statistics for UI
  - [ ] **NOT** extending Detail type (it's a subset, not extension)
- [ ] Use **array** for list data: `xxxList: XxxListItem[]`
- [ ] Use **Map** for detail data: `xxxDetailMap: Record<string, Xxx>`
- [ ] Add per-item loading: `loadingXxxDetailIds: string[]`
- [ ] Create **reducer** for detail map if optimistic updates needed
- [ ] Add **internal dispatch** and **loading** methods
- [ ] Create **selectors** for clean access (optional but recommended)
- [ ] Document in comments:
  - [ ] What fields are excluded from List and why
  - [ ] What computed fields mean
  - [ ] What each Map is for

---

## Best Practices

1. **File organization** - One entity per file, not mixed together
2. **List is subset** - ListItem excludes heavy fields, not extends Detail
3. **Clear naming** - `xxxList` for arrays, `xxxDetailMap` for maps
4. **Consistent patterns** - All detail maps follow same structure
5. **Type safety** - Never use `any`, always use proper types
6. **Document exclusions** - Comment which fields are excluded from List and why
7. **Selectors** - Encapsulate access patterns
8. **Loading states** - Per-item for details, global for lists
9. **Immutability** - Use Immer in reducers

### Common Mistakes to Avoid

❌ **DON'T extend Detail in List:**

```typescript
// Wrong - List should not extend Detail
export interface BenchmarkListItem extends Benchmark {
  testCaseCount?: number;
}
```

✅ **DO create separate subset:**

```typescript
// Correct - List is a subset with computed fields
export interface BenchmarkListItem {
  id: string;
  name: string;
  // ... only necessary fields
  testCaseCount?: number; // Computed
}
```

❌ **DON'T mix entities in one file:**

```typescript
// Wrong - all entities in agentEvalEntities.ts
```

✅ **DO separate by entity:**

```typescript
// Correct - separate files
// benchmark.ts
// agentEvalDataset.ts
// agentEvalRun.ts
```

---

## Related Skills

- `data-fetching` - How to fetch and update this data
- `zustand` - General Zustand patterns
