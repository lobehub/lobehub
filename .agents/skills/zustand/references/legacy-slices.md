# Legacy Slices (actions flattened into state)

Most stores still compose action classes into the Zustand state with `flattenActions`. Follow this layout only when editing one of them. New stores, and stores moving their data onto `@lobechat/replica`, use the state-only layout in [SKILL.md](../SKILL.md). Reference store: `src/store/eval` (benchmark slice).

## Layout

```plaintext
src/store/<domain>/
├── initialState.ts      # intersects every slice state, spreads every slice initial value
├── store.ts             # XStore = XState & XAction; createStore + flattenActions
├── selectors.ts         # re-exports slice selectors
└── slices/<slice>/
    ├── action.ts        # XActionImpl class + create*Slice helper
    ├── initialState.ts
    ├── reducer.ts       # optional: detail-map reducer
    └── selectors.ts     # xxxSelectors aggregate
```

Large slices split actions into an `actions/` directory (see `src/store/chat/slices/agentRun/actions/`).

## Action Classes

```ts
type Setter = StoreSetter<EvalStore>;

export const createBenchmarkSlice = (set: Setter, get: () => EvalStore, _api?: unknown) =>
  new BenchmarkActionImpl(set, get, _api);

export class BenchmarkActionImpl {
  readonly #get: () => EvalStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => EvalStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshBenchmarks = async (): Promise<void> => {
    await mutate(evalKeys.benchmarks());
  };
}

export type BenchmarkAction = Pick<BenchmarkActionImpl, keyof BenchmarkActionImpl>;
```

- Keep the `(set, get, api)` constructor shape. Drop `#set` (and `setNamespace`) when the class never writes state; mark the param `_set` with `void _set`.
- Calls into another class go through `this.#get().otherAction()`. When the callee is not on the store type the class sees, widen `get` with a local augmentation type, e.g. `ChatGroupStoreWithInternal` in `src/store/agentGroup/slices/curd.ts`.

## Composition

```ts
const createStore: StateCreator<EvalStore, [['zustand/devtools', never]]> = (...parameters) => ({
  ...initialState,
  ...flattenActions<EvalStoreAction>([
    createBenchmarkSlice(...parameters),
    createDatasetSlice(...parameters),
    new EvalStoreResetAction(...parameters),
  ]),
});
```

- Merge class instances with `flattenActions`; spreading an instance drops prototype methods. On a key collision the first instance wins.
- A slice made of several classes composes them the same way in its own entry and types the result as `PublicActions<A & B & …>` (`src/store/agentGroup/action.ts`) so `#private` fields stay out of the store type.
- Do not keep an old `StateCreator` object slice and its class replacement active at the same time.

## Action Types

| Kind     | Naming                                | Role                                                                |
| -------- | ------------------------------------- | ------------------------------------------------------------------- |
| Public   | verb (`updateBenchmark`, `useFetchX`) | what components call; orchestration                                 |
| Internal | `internal_` prefix                    | shared logic other classes call through `get()`; not called from UI |
| Dispatch | `internal_dispatch<Entity>`           | runs a reducer on a map and `set`s the result only when it changed  |

The `internal_*` names are a convention only: they are still public members of the store.

## Reads (SWR → store)

```ts
useFetchBenchmarkDetail = (id?: string): SWRResponse =>
  useClientDataSWR(
    id ? evalKeys.benchmarkDetail(id) : null,
    () => agentEvalService.getBenchmark(id!),
    {
      onSuccess: (data) => {
        this.#get().internal_dispatchBenchmarkDetail({
          id: id!,
          type: 'setBenchmarkDetail',
          value: data,
        });
      },
    },
  );
```

Return the SWR response so components can render `error`. Invalidate with `refreshX = () => mutate(key)`. Request lifecycle and error rendering belong to the `data-fetching-architecture` skill.

## Writes

- **Reducer vs `set`**: run maps and lists through a reducer (`reducer.ts`, Immer `produce`, discriminated-union payloads; see [reducer](data-structures/reducer.md)). Toggle booleans and set scalar fields with a plain labelled `set`.
- **Optimistic create/update**: dispatch the change, call the service, then refresh the affected keys. Track per-row pending ids (`loadingXxxDetailIds`) and clear them in `finally`. A failure must refresh or restore — never leave a successful-looking edit.
- **Delete**: call the service first and remove the row after it succeeds. Hand-written reducers have no rollback base, so an optimistic delete cannot be undone reliably. (Replica stores do delete optimistically; the engine rolls back.)

```ts
updateBenchmark = async (params: UpdateParams): Promise<void> => {
  this.#get().internal_dispatchBenchmarkDetail({
    id: params.id,
    type: 'updateBenchmarkDetail',
    value: params,
  });
  this.#get().internal_updateBenchmarkDetailLoading(params.id, true);
  try {
    await agentEvalService.updateBenchmark(params);
    await this.#get().refreshBenchmarks();
    await this.#get().refreshBenchmarkDetail(params.id);
  } finally {
    this.#get().internal_updateBenchmarkDetailLoading(params.id, false);
  }
};
```

## State Naming

- Detail maps: `xxxDetailMap`; query-keyed maps: `xxxMap` / `xxxMaps`
- Per-row pending: `loadingXxxIds`, `xxxEditingIds`
- Active selection: `activeXxxId`
- First successful load: `xxxInit`
