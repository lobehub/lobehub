import type { ReplicaPagedData, ReplicaPageResult, ReplicaPagingConfig } from './paging';
import type { ReplicaResource, ReplicaScope, ReplicaStorage } from './types';

/** Persisted row key: one row per entry key and query. */
export const replicaStorageKey = (key: string, query?: string) => (query ? `${key}?${query}` : key);

/** Deterministic JSON: sorted keys, `undefined` dropped. */
export const stableQueryKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .filter((key) => item[key] !== undefined)
            .map((key) => [key, item[key]]),
        )
      : item,
  ) ?? '';

/**
 * A fixed identity partition. The default for apps without accounts; an app
 * with sign-in passes a scope derived from the signed-in user / workspace so
 * one browser profile never mixes two identities' rows.
 */
export const staticReplicaScope = (scope = 'default'): ReplicaScope => ({
  canPersist: () => true,
  get: () => scope,
  use: () => scope,
});

const DEFAULT_SCOPE = staticReplicaScope();

/** Builds the storage of one resource from its namespace (`replica:<name>:v<version>`). */
export type ReplicaStorageFactory<TData> = (namespace: string) => ReplicaStorage<TData> | undefined;

export interface DefineReplicaOptions<TParams, TData, TFetched = TData> {
  /** Default network fetcher; a store binding may override it. */
  fetcher?: (params: TParams, cursor?: any) => Promise<TFetched>;
  /** Entry identity inside one scope (memory bucket + persisted row). */
  key: (params: TParams) => string;
  name: string;
  paging?: ReplicaPagingConfig<any>;
  /**
   * Query identity beyond `key` (filters, sort, page size) — anything that
   * changes the rows without changing the key. Persisted rows are kept per
   * query, so a projection taken under other filters never hydrates; in memory
   * a query change resets loaded pages.
   */
  query?: (params: TParams) => unknown;
  /** Identity partition of memory and persisted rows. Defaults to one static scope. */
  scope?: ReplicaScope;
  /** Persisted copy of the replica. Omit for a memory-only replica (no first-frame paint). */
  storage?: ReplicaStorage<TData> | ReplicaStorageFactory<TData>;
  /** Bump to invalidate every persisted row written by older shapes. */
  version: number;
}

export const defineReplica = <TParams, TData, TFetched = TData>(
  options: DefineReplicaOptions<TParams, TData, TFetched>,
): ReplicaResource<TParams, TData, TFetched> => {
  const namespace = `replica:${options.name}:v${options.version}`;
  const storage =
    typeof options.storage === 'function' ? options.storage(namespace) : options.storage;

  return {
    fetcher: options.fetcher,
    key: options.key,
    name: options.name,
    namespace,
    paging: options.paging,
    persisted: !!storage,
    query: (params) => (options.query ? stableQueryKey(options.query(params)) : undefined),
    storageKey: (params) =>
      replicaStorageKey(
        options.key(params),
        options.query ? stableQueryKey(options.query(params)) : undefined,
      ),
    scope: options.scope ?? DEFAULT_SCOPE,
    storage,
    version: options.version,
  };
};

export interface DefinePagedReplicaOptions<TParams, TItem, TCursor> extends Omit<
  DefineReplicaOptions<
    TParams,
    ReplicaPagedData<TItem, TCursor>,
    ReplicaPageResult<TItem, TCursor>
  >,
  'fetcher' | 'paging' | 'storage'
> {
  /** `cursor` is `undefined` for the head page. */
  fetchPage?: (
    params: TParams,
    cursor: TCursor | undefined,
  ) => Promise<ReplicaPageResult<TItem, TCursor>>;
  paging: ReplicaPagingConfig<TItem>;
  storage?: ReplicaStorage<any> | ReplicaStorageFactory<any>;
}

/**
 * A resource whose value is a paged list ({@link ReplicaPagedData}). The
 * store view type may extend the paged shape with domain fields.
 */
export const definePagedReplica = <
  TParams,
  TItem,
  TCursor = number,
  TData extends ReplicaPagedData<TItem, TCursor> = ReplicaPagedData<TItem, TCursor>,
>(
  options: DefinePagedReplicaOptions<TParams, TItem, TCursor>,
): ReplicaResource<TParams, TData, ReplicaPageResult<TItem, TCursor>> =>
  defineReplica<TParams, TData, ReplicaPageResult<TItem, TCursor>>({
    ...options,
    fetcher: options.fetchPage,
    storage: options.storage as ReplicaStorage<TData> | ReplicaStorageFactory<TData> | undefined,
  });
