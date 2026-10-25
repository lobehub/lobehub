import {
  definePagedReplica as defineCorePagedReplica,
  type DefinePagedReplicaOptions,
  defineReplica as defineCoreReplica,
  type DefineReplicaOptions,
  isReplicaSyncKey,
  type ReplicaPagedData,
  type ReplicaResource,
  type ReplicaScope,
  type ReplicaStorage,
} from 'local-replica';
import {
  createReplicaSlice as createCoreReplicaSlice,
  type CreateReplicaSliceOptions,
  createSWRDriver,
} from 'local-replica/zustand';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { getCacheScope, isScopeTrusted, useCacheScope } from '@/libs/swr/useCacheScope';

import { notifyReplicaDevtools, registerReplicaDevtools } from './devtools';
import { AppIndexedDBStorage, AppLocalStorage } from './storage';

/**
 * LobeHub wiring of `local-replica`: replicas are partitioned like the SWR
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

/**
 * The identity half of a cache scope (`${userId}:${workspaceId}`), with the
 * workspace replaced by a marker no workspace id can take.
 */
export const identityScopeOf = (scope: string): string => {
  const separator = scope.indexOf(':');
  return `${separator === -1 ? scope : scope.slice(0, separator)}:*`;
};

/**
 * A scope partitioned by identity only, for data the server owns per user and
 * shares across workspaces (user memories, personal model preferences).
 *
 * Partitioning such a resource per workspace lets a switch hydrate another
 * workspace's older persisted copy, and leaves one `clear()` unable to reach
 * the rows written in the others. The gates still follow the live scope, so an
 * untrusted (identity-unresolved) scope keeps refusing writes.
 */
export const identityOnlyScope: ReplicaScope = {
  canHydrate: () => cacheScope.canHydrate?.() ?? true,
  canPersist: () => cacheScope.canPersist(),
  get: () => identityScopeOf(cacheScope.get()),
  use: () => identityScopeOf(cacheScope.use()),
};

export type ReplicaStorageKind = 'indexedDB' | 'localStorage' | 'memory';

type AppStorageOption<TData> =
  ReplicaStorageKind | ReplicaStorage<TData> | ((namespace: string) => ReplicaStorage<TData>);

const resolveStorage =
  <TData>(storage: AppStorageOption<TData> = 'indexedDB') =>
  (namespace: string): ReplicaStorage<TData> | undefined => {
    if (typeof storage === 'function') return storage(namespace);
    if (typeof storage === 'object') return storage;
    if (storage === 'indexedDB') return new AppIndexedDBStorage<TData>({ namespace });
    if (storage === 'localStorage') return new AppLocalStorage<TData>({ namespace });
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

export { AppIndexedDBStorage, AppLocalStorage } from './storage';
export * from 'local-replica';
export {
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
  splitPagedLens,
} from 'local-replica/zustand';
