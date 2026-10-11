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

/**
 * LobeHub wiring of `@lobechat/replica`: replicas are partitioned like the SWR
 * cache (`${userId}:${workspaceId}`), persist to IndexedDB by default and
 * fetch through the app's SWR hook (workspace-augmented keys, retry policy).
 */

/**
 * Whether this runtime may hydrate replicas from their persisted projection.
 *
 * The Workbench runtime renders the public acceptance / verify surfaces and
 * never mounts the user store, so its cache scope stays the last-known user's
 * partition. Hydrating there would paint a previous — possibly expired or
 * server-invalidated — session's private rows before any authorization is
 * checked, so the Workbench entry turns hydration off at boot. The main SPA
 * keeps it on for the instant-from-cache first paint (it hydrates the persisted
 * partition in parallel with the session check, then resets on a scope change).
 */
let replicaHydrationEnabled = true;

/** Enable/disable reads from the persisted projection for this runtime. */
export const setReplicaPersistedHydration = (enabled: boolean): void => {
  replicaHydrationEnabled = enabled;
};

export const cacheScope: ReplicaScope = {
  canHydrate: () => replicaHydrationEnabled,
  canPersist: isScopeTrusted,
  get: getCacheScope,
  use: useCacheScope,
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
  mutate: (match) => mutate(match),
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
) => createCoreReplicaSlice(resource, { driver: replicaSWRDriver, ...options });

export * from '@lobechat/replica';
export {
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
  splitPagedLens,
} from '@lobechat/replica/zustand';
