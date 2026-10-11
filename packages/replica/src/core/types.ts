import type { ReplicaPagingConfig } from './paging';

// ---- persistence contract ----------------------------------------------

/** Address of one persisted row: the resource's row key inside an identity scope. */
export interface ReplicaRowKey {
  queryKey: string;
  scope: string;
}

export interface ReplicaRow<T> {
  data: T;
  updatedAt: number;
}

/**
 * Where a replica keeps its rows between sessions (IndexedDB, localStorage …).
 * Best-effort by contract: the server stays the durable source of truth, so
 * an implementation should swallow its own I/O failures.
 */
export interface ReplicaStorage<T> {
  get: (key: ReplicaRowKey) => Promise<ReplicaRow<T> | undefined>;
  remove: (key: ReplicaRowKey) => Promise<void>;
  set: (key: ReplicaRowKey, row: ReplicaRow<T>) => Promise<void>;
}

/**
 * Where the confirmed value of an entry came from.
 * - `storage`: hydrated from the persisted projection (may be stale)
 * - `server`: confirmed by a network response
 * - `local`: written locally before any hydrate/replace landed
 * - `seed`: a provisional local row (e.g. a list row standing in for a detail so
 *   an object stays resolvable). Unlike `local` it is *not* authoritative: a
 *   persisted `storage` value may replace it on hydrate, and it never persists —
 *   so it cannot overwrite the detail it is only standing in for.
 */
export type ReplicaSource = 'local' | 'seed' | 'server' | 'storage';

/**
 * Identity partition of the persisted projection (user + workspace by default).
 * `use` feeds the sync hook, `get` imperative actions, `canPersist` gates writes
 * while the scope is still an optimistic guess (identity not resolved yet).
 */
export interface ReplicaScope {
  /**
   * Whether this runtime may read the persisted projection back into memory.
   * Defaults to `true`. A surface that never resolves an identity (e.g. a
   * public embed that does not mount the user store) opts out: its scope is
   * only the last-known guess, so hydrating it could paint a different — or a
   * since-invalidated — session's private rows before authorization is checked.
   */
  canHydrate?: () => boolean;
  canPersist: () => boolean;
  get: () => string;
  use: () => string;
}

export interface ReplicaPendingMutation<T> {
  apply: (data: T) => T;
  id: number;
}

export interface ReplicaEntryMeta<T> {
  /**
   * Confirmed snapshot. Only kept while optimistic mutations are in flight —
   * otherwise the view itself is the confirmed value.
   */
  base?: T;
  /** Params of the last hydrate/replace — what `loadMore` pages with. */
  params?: unknown;
  pending: ReplicaPendingMutation<T>[];
  /** Stable query identity beyond the key (filters, page size). */
  query?: string;
  /**
   * Confirmed (non-seed) writes made while the entry is still a `seed`. The seed
   * stays provisional (persisting it would clobber the stored detail), so a
   * hydrate that replaces it replays these onto the stored value — a confirmed
   * edit made before storage answered is not lost, and then persists.
   */
  seedPatches?: ReplicaSeedPatch<T>[];
  source: ReplicaSource;
  updatedAt: number;
}

export interface ReplicaSeedPatch<T> {
  apply: (data: T | undefined) => T | undefined;
  persist: boolean;
}

/** Bookkeeping slot a replica keeps inside its domain store. */
export interface ReplicaState<T> {
  entries: Record<string, ReplicaEntryMeta<T>>;
  /**
   * Keys explicitly removed while a hydrate for them might still be in flight.
   * A removal deletes the entry and its row, but a storage read that started
   * before it can still resolve afterwards; hydrate skips these so the stale
   * read cannot resurrect the entry (e.g. a group the server confirmed gone).
   * A later authoritative write (`replace` / `update` / `optimistic`) claims the
   * key again, and a scope reset drops every marker.
   */
  removed?: Record<string, true>;
  /** The scope every entry in memory belongs to. */
  scope?: string;
}

export interface ReplicaResource<TParams, TData, TFetched = TData, TCursor = any> {
  /** Paged resources receive the page cursor (`undefined` = head page). */
  fetcher?: (params: TParams, cursor?: TCursor) => Promise<TFetched>;
  key: (params: TParams) => string;
  name: string;
  /** Storage namespace — `name` + `version`, so a version bump orphans old rows. */
  namespace: string;
  /** Present on paged resources (`definePagedReplica`). */
  paging?: ReplicaPagingConfig<any, TCursor>;
  /** Whether the resource survives a reload (it has a storage). */
  persisted: boolean;
  /** Whether an entry key may be hydrated and persisted (see `persistKey`). */
  persistKey: (key: string) => boolean;
  /**
   * Query identity beyond `key` (filters, page size). Persisted rows are
   * stored per query, so a different query never hydrates; in memory a query
   * change resets loaded pages.
   */
  query: (params: TParams) => string | undefined;
  scope: ReplicaScope;
  storage?: ReplicaStorage<TData>;
  /** Row key in `storage` for these params (`key`, plus `?query` when set). */
  storageKey: (params: TParams) => string;
  /** Custom query-cache key of the network sync (see `DefineReplicaOptions.syncKey`). */
  syncKey?: (params: TParams) => readonly unknown[];
  version: number;
}
