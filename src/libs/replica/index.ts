import {
  definePagedReplica as defineCorePagedReplica,
  type DefinePagedReplicaOptions,
  defineReplica as defineCoreReplica,
  type DefineReplicaOptions,
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

export const cacheScope: ReplicaScope = {
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

/** `createReplicaSlice` bound to the app's SWR driver. */
export const createReplicaSlice = <TStore, TParams, TData, TFetched = TData>(
  resource: ReplicaResource<TParams, TData, TFetched>,
  options: Omit<CreateReplicaSliceOptions<TStore, TParams, TData, TFetched>, 'driver'>,
) => createCoreReplicaSlice(resource, { driver: replicaSWRDriver, ...options });

export * from '@lobechat/replica';
export { recordLens, type ReplicaSyncResult } from '@lobechat/replica/zustand';
