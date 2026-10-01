import type { QueryProjectionStorage } from '@/libs/queryProjectionStorage';

/**
 * Where the confirmed value of an entry came from.
 * - `storage`: hydrated from the persisted projection (may be stale)
 * - `server`: confirmed by a network response
 * - `local`: written locally before any hydrate/replace landed
 */
export type LocalFirstSource = 'local' | 'server' | 'storage';

export type LocalFirstStorageKind = 'indexedDB' | 'localStorage' | 'memory';

/**
 * Identity partition of the persisted projection (user + workspace by default).
 * `use` feeds the sync hook, `get` imperative actions, `canPersist` gates writes
 * while the scope is still an optimistic guess (identity not resolved yet).
 */
export interface LocalFirstScope {
  canPersist: () => boolean;
  get: () => string;
  use: () => string;
}

export interface LocalFirstPendingMutation<T> {
  apply: (data: T) => T;
  id: number;
}

export interface LocalFirstEntryMeta<T> {
  /**
   * Confirmed snapshot. Only kept while optimistic mutations are in flight —
   * otherwise the view itself is the confirmed value.
   */
  base?: T;
  pending: LocalFirstPendingMutation<T>[];
  source: LocalFirstSource;
  updatedAt: number;
}

/** Bookkeeping slot a local-first resource keeps inside its domain store. */
export interface LocalFirstState<T> {
  entries: Record<string, LocalFirstEntryMeta<T>>;
  /** The scope every entry in memory belongs to. */
  scope?: string;
}

export interface LocalFirstResource<TParams, TData, TFetched = TData> {
  fetcher?: (params: TParams) => Promise<TFetched>;
  key: (params: TParams) => string;
  name: string;
  /** Storage namespace — `name` + `version`, so a version bump orphans old rows. */
  namespace: string;
  /** Whether the resource survives a reload (`storage !== 'memory'`). */
  persisted: boolean;
  scope: LocalFirstScope;
  storage?: QueryProjectionStorage<TData>;
  version: number;
}
