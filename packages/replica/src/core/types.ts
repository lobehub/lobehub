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
 * The server stays the durable source of truth, so `get` is best-effort: it
 * swallows its own I/O failures and reports a miss. Writes are not: `set` and
 * `remove` must reject when they did not land (see each method), so the
 * engine can retry them instead of treating a dropped row as persisted.
 */
export interface ReplicaStorage<T> {
  get: (key: ReplicaRowKey) => Promise<ReplicaRow<T> | undefined>;
  /**
   * Strict read for destructive passes: like `get`, but **rejects** when the
   * row could not be read (I/O error, unparsable value) instead of reporting a
   * miss. The engine reads its per-scope index (and every row it patches)
   * through it before `remove` / `clear` / an entity patch / an eviction, so an
   * unreadable index fails the pass rather than passing for an empty one.
   *
   * Optional only for compatibility: a storage without it still hydrates and
   * persists, but every destructive pass **fails** (`clear()` resolves `false`,
   * a removal stays unpurged and is retried, an entity guard is kept) because
   * the engine cannot tell a miss from a failed read through `get`.
   */
  getStrict?: (key: ReplicaRowKey) => Promise<ReplicaRow<T> | undefined>;
  /**
   * Delete a row. Must **reject** when the delete did not land (a closed
   * IndexedDB, a quota or security error): the engine keeps the row indexed
   * and the removal unpurged, so the next `remove` / `clear` retries it instead
   * of letting a row the user deleted hydrate again. A missing row is a success.
   */
  remove: (key: ReplicaRowKey) => Promise<void>;
  /**
   * Write a row. Should **reject** when the write did not land: the engine only
   * treats a row as holding a value after `set` resolved, so a rejected write is
   * retried by the next persist rather than skipped as redundant. A storage that
   * swallows failures still works, but a dropped write then survives until the
   * value changes or the next session.
   */
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
  /**
   * Query the overlay was started under. An entry key can be reused for another
   * query (a navigation), and an overlay only ever describes the query that
   * created it — carrying it over would apply (and later persist) one query's
   * row inside another.
   */
  query?: string;
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
   * Every write made while the entry is still a `seed`, in order — the seed
   * writes themselves and the confirmed writes made over them. A hydrate that
   * replaces the seed replays them onto the stored value: the seed's fresher
   * fields (a list row's renamed title) and a confirmed edit made before
   * storage answered both survive, instead of storage painting older values.
   */
  seedPatches?: ReplicaSeedPatch<T>[];
  source: ReplicaSource;
  updatedAt: number;
}

export interface ReplicaSeedPatch<T> {
  /**
   * Replayed onto the stored value, so a seed write must merge the fields it
   * owns into its input rather than ignore it (its first run sees `undefined`).
   */
  apply: (data: T | undefined) => T | undefined;
  persist: boolean;
  /** A provisional seed write: replayed, but never makes the result confirmed. */
  seed?: boolean;
  /**
   * Source of a seed write. A later seed of the same tag supersedes this one
   * (since the last confirmed write), so it must carry every field this one set.
   */
  tag?: string;
}

/** Bookkeeping slot a replica keeps inside its domain store. */
export interface ReplicaState<T> {
  entries: Record<string, ReplicaEntryMeta<T>>;
  /** The scope every entry in memory belongs to. */
  scope?: string;
}

export interface ReplicaResource<TParams, TData, TFetched = TData, TCursor = any> {
  /** Paged resources receive the page cursor (`undefined` = head page). */
  fetcher?: (params: TParams, cursor?: TCursor) => Promise<TFetched>;
  key: (params: TParams) => string;
  /** Cap of persisted rows per scope (LRU eviction, see `DefineReplicaOptions.persist`). */
  maxPersistedEntries?: number;
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
