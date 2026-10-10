---
name: zustand
description: 'Use for Zustand stores: state shapes and type sources, state-only stores with xActions classes, replica-backed list/detail data (@lobechat/replica), selectors, optimistic writes, and legacy slice/internal_* action composition.'
user-invocable: false
---

# LobeHub Zustand State Management

## State Shapes and Types

- Import shared store types from `@lobechat/types`, not `@lobechat/database`.
- Keep lightweight list-item types separate from full detail types; list types must not extend heavy detail types.
- Key cached details by id (`xxxDetailMap: Record<string, Detail>`); never hold a single `currentDetail` object.
- Read through `xxxSelectors` aggregates (`selectors.ts`), not ad-hoc lambdas repeated across components.
- Before choosing list/detail shapes or type sources, read [Data structures](references/data-structures.md).

## State-Only Stores (default for new and migrated stores)

Actions stay out of the Zustand state. Reference: `src/store/page`.

| File               | Owns                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `store.ts`         | `useXStore = createWithEqualityFn<XState>()(devtools(() => initialState), shallow)`: state only, no methods              |
| `privateAction.ts` | `XPrivateAction`: replica slices, entity links, and write helpers shared by public actions. Not exported from `index.ts` |
| `action.ts`        | `XActionImpl` (the public API) and the singleton `xActions = new XActionImpl(setState, getState, new XPrivateAction(…))` |

- Components read state with `useXStore(selector)` and call `xActions.foo()` directly. Never select an action out of the store.
- Sync hooks live on the public class and are called as `xActions.useFetchX(params)`.
- Public actions call each other through `this.foo()`. Private helpers are reached through `this.#private`. Do not add `internal_*` methods to the store to share logic between classes.
- Label every write: `this.#set(partial, false, n('actionName'))` with `const n = setNamespace('x')`.
- Put `reset()` on the public class and register `xActions` in `resetableActions` in `src/store/utils/userDataStores.ts`.
- Tests drive `xActions` and assert on `useXStore.getState()`. To mock in component tests: `vi.mock('@/store/x', () => ({ xActions: { foo: vi.fn() }, useXStore: … }))`.

## Replica-Backed Server Data

Server lists and details the UI paints go through `@/libs/replica`, not a hand-written SWR `onSuccess` + reducer. The engine owns hydration from IndexedDB, head revalidation, paging, optimistic overlays with rollback, and scope (user + workspace) isolation. API reference: [`packages/replica/README.md`](../../../packages/replica/README.md).

1. Define the resource (`defineReplica` / `definePagedReplica`) in the store's `projection.ts`, converting server rows at the boundary.
2. Add two state fields per replica: the view (`xxxMap: Record<key, TData>`) and its bookkeeping (`xxxReplica: createReplicaState()`).
3. Bind it in the private class: `createReplicaSlice(resource, { get, set, stateKey: 'xxxReplica', view: recordLens('xxxMap'), … })`. When the same entity lives in several replicas (list row + detail), link them with `linkReplicaEntity([list, detail])`.
4. Read: `slice.useSync(params)` returns only fetch flags (`isHydrated`, `isValidating`, `error`, `revalidate`). Data comes from selectors over `xxxMap`. "Entry is `undefined`" is the loading signal — do not add `xxxInit` flags or `loadingXxxIds`.
5. Cold start without a skeleton: `useSync` hydrates only after the component mounts. For a list that must paint from the local copy, add a `preHydrate` action (`ensureScope` + `hydrate`) and call it from the route's `loader` through a lazy wrapper (`src/spa/router/pageListLoader.ts`, `agentChatTopicListLoader.ts`) bounded by `PRE_PAINT_HYDRATE_TIMEOUT`.
6. Write: `slice.optimistic(key, apply, serverCall)` or `entity.optimistic(id, fn | 'remove', serverCall)`. A failed call rolls back to the confirmed value, so deletes are optimistic too. Rows that exist only on the client (temp ids) are declared with `isClientOnly` and seeded with `update(key, fn, { persist: false })`.

Outside test seeding, write a replica's view only through its slice. A plain `set` bypasses the engine's bookkeeping (persistence, rollback base, entity links).

## Legacy Stores

Stores that still flatten action classes into state (`flattenActions`, `create*Slice`, `internal_*`, `internal_dispatch*` + reducers, SWR `onSuccess` syncing) follow [Legacy slices](references/legacy-slices.md). Use that layout only when editing one of those stores; migrate to the layouts above when moving its data onto a replica.
