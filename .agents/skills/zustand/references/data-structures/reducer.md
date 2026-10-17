# Reducer Pattern (for Detail Map)

Legacy stores only. Replica-backed data gets optimistic writes and rollback from the engine; do not add a reducer for it.

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
  SetBenchmarkDetailAction | UpdateBenchmarkDetailAction | DeleteBenchmarkDetailAction;

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

## Wiring It to the Store

The action class exposes one dispatch method that runs the reducer and skips `set` when nothing changed (`src/store/eval/slices/benchmark/action.ts`):

```typescript
internal_dispatchBenchmarkDetail = (payload: BenchmarkDetailDispatch): void => {
  const currentMap = this.#get().benchmarkDetailMap;
  const nextMap = benchmarkDetailReducer(currentMap, payload);

  if (isEqual(nextMap, currentMap)) return;

  this.#set({ benchmarkDetailMap: nextMap }, false, `dispatchBenchmarkDetail/${payload.type}`);
};
```

Components call public mutations (`updateBenchmark`), which call `internal_dispatch*`; the dispatch payload shapes stay out of the component layer.
