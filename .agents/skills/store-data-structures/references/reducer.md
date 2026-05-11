# Reducer Pattern (for Detail Map)

## Why Use a Reducer?

- **Immutable updates** — Immer makes immutability easy
- **Type-safe actions** — discriminated union of action types prevents typos
- **Testable** — pure function, easy to unit test
- **Reusable** — same reducer powers optimistic updates and server-data writes

## Reducer Structure

```typescript
// src/store/eval/slices/benchmark/reducer.ts
import { produce } from 'immer';
import type { AgentEvalBenchmark } from '@lobechat/types';

// Action types — discriminated union
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

## Internal Dispatch Methods

The slice exposes two `internal_*` methods so the reducer and the loading state stay encapsulated behind a stable contract:

```typescript
// In action.ts
export interface BenchmarkAction {
  // ... other methods ...

  // Internal — not for direct UI use
  internal_dispatchBenchmarkDetail: (payload: BenchmarkDetailDispatch) => void;
  internal_updateBenchmarkDetailLoading: (id: string, loading: boolean) => void;
}

export const createBenchmarkSlice: StateCreator<...> = (set, get) => ({
  // ... other methods ...

  // Dispatch to reducer
  internal_dispatchBenchmarkDetail: (payload) => {
    const currentMap = get().benchmarkDetailMap;
    const nextMap = benchmarkDetailReducer(currentMap, payload);

    // Skip set when nothing changed — avoids unnecessary re-renders
    if (isEqual(nextMap, currentMap)) return;

    set(
      { benchmarkDetailMap: nextMap },
      false,
      `dispatchBenchmarkDetail/${payload.type}`,
    );
  },

  // Update loading state for a specific id
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

The `internal_` prefix is a convention — UI components should call the public mutation methods (e.g. `updateBenchmark`), which in turn call `internal_dispatch*`. This keeps reducer dispatch shapes out of the component layer.
