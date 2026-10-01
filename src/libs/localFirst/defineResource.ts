import {
  IndexedDBQueryProjectionStorage,
  LocalStorageQueryProjectionStorage,
  type QueryProjectionStorage,
} from '@/libs/queryProjectionStorage';
import { getCacheScope, isScopeTrusted, useCacheScope } from '@/libs/swr/useCacheScope';

import type { LocalFirstResource, LocalFirstScope, LocalFirstStorageKind } from './types';

/** Default scope: the same `${userId}:${workspaceId}` partition the SWR cache uses. */
export const cacheScope: LocalFirstScope = {
  canPersist: isScopeTrusted,
  get: getCacheScope,
  use: useCacheScope,
};

export interface DefineLocalFirstResourceOptions<TParams, TData, TFetched = TData> {
  /** Default network fetcher; a store binding may override it. */
  fetcher?: (params: TParams) => Promise<TFetched>;
  /** Entry identity inside one scope (memory bucket + persisted row). */
  key: (params: TParams) => string;
  name: string;
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
    persisted: !!storage,
    scope: options.scope ?? cacheScope,
    storage,
    version: options.version,
  };
};
