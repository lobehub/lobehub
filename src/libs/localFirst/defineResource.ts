import {
  IndexedDBQueryProjectionStorage,
  LocalStorageQueryProjectionStorage,
  type QueryProjectionStorage,
} from '@/libs/queryProjectionStorage';
import { getCacheScope, isScopeTrusted, useCacheScope } from '@/libs/swr/useCacheScope';

import type { LocalFirstPagedData, LocalFirstPageResult, LocalFirstPagingConfig } from './paging';
import type { LocalFirstResource, LocalFirstScope, LocalFirstStorageKind } from './types';

/** Persisted row key: one row per entry key and query. */
export const localFirstStorageKey = (key: string, query?: string) =>
  query ? `${key}?${query}` : key;

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

/** Default scope: the same `${userId}:${workspaceId}` partition the SWR cache uses. */
export const cacheScope: LocalFirstScope = {
  canPersist: isScopeTrusted,
  get: getCacheScope,
  use: useCacheScope,
};

export interface DefineLocalFirstResourceOptions<TParams, TData, TFetched = TData> {
  /** Default network fetcher; a store binding may override it. */
  fetcher?: (params: TParams, cursor?: any) => Promise<TFetched>;
  /** Entry identity inside one scope (memory bucket + persisted row). */
  key: (params: TParams) => string;
  name: string;
  paging?: LocalFirstPagingConfig<any>;
  /**
   * Query identity beyond `key` (filters, sort, page size) — anything that
   * changes the rows without changing the key. Persisted rows are kept per
   * query, so a projection taken under other filters never hydrates; in memory
   * a query change resets loaded pages.
   */
  query?: (params: TParams) => unknown;
  scope?: LocalFirstScope;
  /** Defaults to `indexedDB`. Pass a storage instance to inject one (tests). */
  storage?: LocalFirstStorageKind | QueryProjectionStorage<TData>;
  /** Bump to invalidate every persisted row written by older shapes. */
  version: number;
}

const createStorage = <TData>(
  kind: LocalFirstStorageKind,
  namespace: string,
): QueryProjectionStorage<TData> | undefined => {
  switch (kind) {
    case 'indexedDB': {
      return new IndexedDBQueryProjectionStorage<TData>({ namespace });
    }
    case 'localStorage': {
      return new LocalStorageQueryProjectionStorage<TData>({ namespace });
    }
    case 'memory': {
      return undefined;
    }
  }
};

export const defineLocalFirstResource = <TParams, TData, TFetched = TData>(
  options: DefineLocalFirstResourceOptions<TParams, TData, TFetched>,
): LocalFirstResource<TParams, TData, TFetched> => {
  const namespace = `lobechat-local-first:${options.name}:v${options.version}`;
  const storage =
    typeof options.storage === 'object'
      ? options.storage
      : createStorage<TData>(options.storage ?? 'indexedDB', namespace);

  return {
    fetcher: options.fetcher,
    key: options.key,
    name: options.name,
    namespace,
    paging: options.paging,
    persisted: !!storage,
    query: (params) => (options.query ? stableQueryKey(options.query(params)) : undefined),
    storageKey: (params) =>
      localFirstStorageKey(
        options.key(params),
        options.query ? stableQueryKey(options.query(params)) : undefined,
      ),
    scope: options.scope ?? cacheScope,
    storage,
    version: options.version,
  };
};

export interface DefineLocalFirstPagedResourceOptions<TParams, TItem, TCursor> extends Omit<
  DefineLocalFirstResourceOptions<
    TParams,
    LocalFirstPagedData<TItem, TCursor>,
    LocalFirstPageResult<TItem, TCursor>
  >,
  'fetcher' | 'paging' | 'storage'
> {
  /** `cursor` is `undefined` for the head page. */
  fetchPage?: (
    params: TParams,
    cursor: TCursor | undefined,
  ) => Promise<LocalFirstPageResult<TItem, TCursor>>;
  paging: LocalFirstPagingConfig<TItem>;
  storage?: LocalFirstStorageKind | QueryProjectionStorage<any>;
}

/**
 * A resource whose value is a paged list ({@link LocalFirstPagedData}). The
 * store view type may extend the paged shape with domain fields.
 */
export const defineLocalFirstPagedResource = <
  TParams,
  TItem,
  TCursor = number,
  TData extends LocalFirstPagedData<TItem, TCursor> = LocalFirstPagedData<TItem, TCursor>,
>(
  options: DefineLocalFirstPagedResourceOptions<TParams, TItem, TCursor>,
): LocalFirstResource<TParams, TData, LocalFirstPageResult<TItem, TCursor>> =>
  defineLocalFirstResource<TParams, TData, LocalFirstPageResult<TItem, TCursor>>({
    ...options,
    fetcher: options.fetchPage,
    storage: options.storage as LocalFirstStorageKind | QueryProjectionStorage<TData> | undefined,
  });
