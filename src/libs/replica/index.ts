import {
  definePagedReplica as defineCorePagedReplica,
  type DefinePagedReplicaOptions,
  defineReplica as defineCoreReplica,
  type DefineReplicaOptions,
  isReplicaSyncKey,
  REPLICA_INDEX_KEY,
  type ReplicaPagedData,
  type ReplicaResource,
  type ReplicaScope,
  type ReplicaStorage,
} from '@lobechat/replica';
import {
  createReplicaSlice as createCoreReplicaSlice,
  type CreateReplicaSliceOptions,
  createSWRDriver,
} from '@lobechat/replica/zustand';

import {
  IndexedDBQueryProjectionStorage,
  LocalStorageQueryProjectionStorage,
} from '@/libs/queryProjectionStorage';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { getCacheScope, isScopeTrusted, useCacheScope } from '@/libs/swr/useCacheScope';

import { notifyReplicaDevtools, registerReplicaDevtools } from './devtools';

/**
 * LobeHub wiring of `@lobechat/replica`: replicas are partitioned like the SWR
 * cache (`${userId}:${workspaceId}`), persist to IndexedDB by default and
 * fetch through the app's SWR hook (workspace-augmented keys, retry policy).
 */

/**
 * Where a runtime's replicas take their partition and their persistence gates.
 *
 * The main SPA (the default) resolves the scope from the user store: it
 * hydrates the last-known user's partition in parallel with the session check
 * and resets on a scope change, and it persists only once identity resolves.
 *
 * The Workbench runtime never mounts the user store, so it installs its own
 * source at boot (`apps/workbench/src/shell/workbenchReplicaScope.ts`): network
 * only on its public surfaces, and the same hydrate-then-verify contract as the
 * main SPA on the private routes that run its session check.
 */
export interface ReplicaScopeSource {
  /** Whether a persisted projection may be painted before the network answers. */
  canHydrate: () => boolean;
  /** Whether a server answer may be written to the persisted projection. */
  canPersist: () => boolean;
  get: () => string;
  /** React hook form of `get`; must be stable for the runtime's lifetime. */
  use: () => string;
}

/**
 * The scope hook and getters are referenced at call time, not while this module
 * body runs. `@/libs/swr/useCacheScope` imports `@/store/user`, and a user-store
 * slice imports this module — so when `useCacheScope` is the entry of that
 * cycle this module's body executes before `useCacheScope`'s exports are
 * initialized. Referencing them here directly would bake `undefined` into the
 * scope (a resource would then have no `scope.get`); resolving at call time is
 * equivalent because they are stateless delegating functions.
 */
const useAppCacheScope = (): string => useCacheScope();

const appScopeSource: ReplicaScopeSource = {
  canHydrate: () => true,
  canPersist: () => isScopeTrusted(),
  get: () => getCacheScope(),
  use: useAppCacheScope,
};

let scopeSource: ReplicaScopeSource = appScopeSource;

/** Install this runtime's scope source. Call once at boot, before any render. */
export const setReplicaScopeSource = (source: ReplicaScopeSource): void => {
  scopeSource = source;
};

const useSourceScope = (): string => scopeSource.use();

export const cacheScope: ReplicaScope = {
  canHydrate: () => scopeSource.canHydrate(),
  canPersist: () => scopeSource.canPersist(),
  get: () => scopeSource.get(),
  use: useSourceScope,
};

export type ReplicaStorageKind = 'indexedDB' | 'localStorage' | 'memory';

type AppStorageOption<TData> = ReplicaStorageKind | ReplicaStorage<TData>;

const resolveStorage =
  <TData>(storage: AppStorageOption<TData> = 'indexedDB') =>
  (namespace: string): ReplicaStorage<TData> | undefined => {
    if (typeof storage === 'object') return storage;
    if (storage === 'indexedDB') return new IndexedDBQueryProjectionStorage<TData>({ namespace });
    if (storage === 'localStorage')
      return new LocalStorageQueryProjectionStorage<TData>({ namespace });
    return undefined;
  };

export const defineReplica = <TParams, TData, TFetched = TData>({
  storage,
  ...options
}: Omit<DefineReplicaOptions<TParams, TData, TFetched>, 'storage'> & {
  storage?: AppStorageOption<TData>;
}) =>
  defineCoreReplica<TParams, TData, TFetched>({
    scope: cacheScope,
    ...options,
    storage: resolveStorage(storage),
  });

export const definePagedReplica = <
  TParams,
  TItem,
  TCursor = number,
  TData extends ReplicaPagedData<TItem, TCursor> = ReplicaPagedData<TItem, TCursor>,
>({
  storage,
  ...options
}: Omit<DefinePagedReplicaOptions<TParams, TItem, TCursor>, 'storage'> & {
  storage?: AppStorageOption<TData>;
}) =>
  defineCorePagedReplica<TParams, TItem, TCursor, TData>({
    scope: cacheScope,
    ...options,
    storage: resolveStorage(storage),
  });

// Resolve the SWR bindings per call, not at import: the topic store pulls this
// module in eagerly, and test suites that mock `@/libs/swr` partially must
// still be able to import it.
export const replicaSWRDriver = createSWRDriver({
  // Arguments pass through as given: SWR tells a revalidation from a write by their count.
  mutate: (...args) => (mutate as (...args: unknown[]) => Promise<unknown>)(...args),
  useSWR: (key, fetcher, config) => useClientDataSWR(key, fetcher, config),
});

/**
 * Revalidate a replica's sync queries (one entry, or all of the active scope)
 * from code that cannot reach the owning store without an import cycle.
 */
export const revalidateReplica = (
  resource: Pick<ReplicaResource<any, any, any>, 'name' | 'scope'>,
  key?: string,
) =>
  replicaSWRDriver.revalidate((queryKey) =>
    isReplicaSyncKey(queryKey, resource.name, { key, scope: resource.scope.get() }),
  );

/**
 * The entry storage keys this resource has a persisted row for in the active
 * scope, oldest first.
 *
 * Storage has no key listing of its own; the engine keeps one index row per
 * scope (`REPLICA_INDEX_KEY`) as it persists and drops entries, and this reads
 * it. That is how code outside the owning store reaches rows an *earlier
 * session* wrote — bounding how many survive a reload, or invalidating a row
 * whose entry is not loaded in memory.
 *
 * The keys are storage keys (`key`, plus `?query` when the resource sets one),
 * so a caller only matches them against entry keys when the resource leaves
 * `query` unset.
 */
export const readReplicaStoredKeys = async (
  resource: Pick<ReplicaResource<any, any, any>, 'scope' | 'storage'>,
): Promise<string[]> => {
  const row = await resource.storage?.get({
    queryKey: REPLICA_INDEX_KEY,
    scope: resource.scope.get(),
  });
  return (row?.data as unknown as string[] | undefined) ?? [];
};

/** `createReplicaSlice` bound to the app's SWR driver. */
export const createReplicaSlice = <TStore, TParams, TData, TFetched = TData>(
  resource: ReplicaResource<TParams, TData, TFetched>,
  options: Omit<CreateReplicaSliceOptions<TStore, TParams, TData, TFetched>, 'driver'>,
) => {
  const { get, set, stateKey, view } = options;
  const slice = createCoreReplicaSlice(resource, {
    driver: replicaSWRDriver,
    ...options,
    set: (partial, replace, action) => {
      set(partial, replace, action);
      notifyReplicaDevtools();
    },
  });

  registerReplicaDevtools(resource, { get, slice, stateKey, view });
  return slice;
};

export * from '@lobechat/replica';
export {
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
  splitPagedLens,
} from '@lobechat/replica/zustand';
