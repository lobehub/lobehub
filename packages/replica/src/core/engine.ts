import isEqual from 'fast-deep-equal';

import { isReplicaStorageKeyOf, replicaStorageKey, stableQueryKey } from './defineReplica';
import {
  applyHeadPage,
  applyNextPage,
  collapseToHead,
  getNextPageCursor,
  hasPagedItem,
  insertHeadItems,
  mapPagedItem,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaPagingContext,
  toPersistedPage,
} from './paging';
import type { ReplicaAction, ReplicaEffect, ReplicaViewWrite } from './reducer';
import { replicaReducer } from './reducer';
import { createTombstones, DEFAULT_REMOVAL_TOMBSTONE_LIMIT } from './tombstones';
import type { ReplicaResource, ReplicaSource, ReplicaState } from './types';
import { readReplicaRowStrict, ReplicaWriteQueue } from './writeQueue';

/** Reserved storage key of the per-scope index of persisted rows. */
export const REPLICA_INDEX_KEY = '__replica:index';

/**
 * The engine's view of the host store. The engine never owns the rendered
 * value — the host does (a Zustand slice, a signal, a plain object) — it only
 * reads entries through `read` and hands every transition to `commit`.
 */
export interface ReplicaStorePort<TData> {
  /**
   * Apply the view writes and the next bookkeeping slot as ONE host update, so
   * subscribers never observe a view out of step with its bookkeeping.
   */
  commit: (writes: ReplicaViewWrite<TData>[], state: ReplicaState<TData>, label: string) => void;
  /** Current bookkeeping slot. */
  getState: () => ReplicaState<TData>;
  /** Enumerate loaded keys (entity propagation). Defaults to the bookkeeping entries. */
  keys?: () => string[];
  /** Materialized value of one entry, as the UI sees it. */
  read: (key: string) => TData | undefined;
}

/**
 * How entities (e.g. topics) appear inside a non-paged resource value. Paged
 * resources get this for free from `paging.getId`. Build one with
 * `singleEntity` (a detail value), `arrayEntity` (a plain list) or by hand for
 * nested shapes (grouped lists).
 */
export interface ReplicaEntityAdapter<TData, TItem> {
  /** Whether `data` holds the entity. */
  has: (data: TData, id: string) => boolean;
  /**
   * Map the entity inside `data` (`fn` returning `undefined` deletes it).
   * Return `data` itself when nothing changed, or `undefined` when the whole
   * value goes away with the entity (a detail value).
   */
  map: (data: TData, id: string, fn: (item: TItem) => TItem | undefined) => TData | undefined;
}

export interface ReplicaEngineOptions<TParams, TData, TFetched> {
  /** Label prefix of host updates (devtools action names). Defaults to the resource name. */
  actionPrefix?: string;
  /** Non-paged resources: how entities sit in the value (see `linkReplicaEntity`). */
  entity?: ReplicaEntityAdapter<TData, any>;
  /** Overrides `resource.fetcher` when the fetch needs store context. */
  fetcher?: (params: TParams, cursor?: any) => Promise<TFetched>;
  /** Paged: rows that only exist client-side (kept across refreshes, never persisted). */
  isClientOnly?: (item: any) => boolean;
  /** Reject a persisted value that cannot serve these params. Rarely needed: rows are stored per query. */
  isHydratable?: (cached: TData, params: TParams) => boolean;
  /**
   * Non-paged: whether a head response means the entry no longer exists. Such a
   * response is applied as an explicit removal (memory + persisted row) instead
   * of through `merge` — otherwise a `null` would fall back to the confirmed
   * value (the reducer resolves `action.data(confirmed) ?? confirmed`), so a
   * deleted aggregate would be retained and re-persisted.
   */
  isMissing?: (incoming: TFetched) => boolean;
  /**
   * Non-paged: fold a server response into the confirmed value. Return
   * `undefined` to keep the current value. Defaults to "the response is the value".
   */
  merge?: (incoming: TFetched, confirmed: TData | undefined, params: TParams) => TData | undefined;
  /** Where the engine reads and commits the view. */
  port: ReplicaStorePort<TData>;
  /**
   * Reconcile a server response with the value currently shown before it is
   * folded in — e.g. keep a row the client knows is newer, or ignore a
   * response that raced a newer local state. Return `undefined` to drop the
   * response entirely.
   */
  prepareHead?: (
    incoming: TFetched,
    current: TData | undefined,
    params: TParams,
  ) => TFetched | undefined;
  /** Re-run the network sync of one entry (or all); wired by the fetch adapter. */
  revalidate?: (key?: string) => Promise<unknown>;
  /**
   * Strip transient / client-only parts before persisting.
   *
   * - a value → persisted
   * - `undefined` → skip this write (keep whatever is already stored)
   * - `null` → the entry is a server-confirmed absence: drop any prior
   *   persisted projection, so a later hydrate cannot paint a value the server
   *   no longer has (the view keeps the confirmed value).
   */
  toPersisted?: (data: TData) => TData | null | undefined;
  /** Paged: domain fields derived from params, written with every head page. */
  viewFields?: (params: TParams) => Partial<TData>;
}

/** What a head response did once folded in (see `applyHead`). */
export type ReplicaHeadOutcome = 'dropped' | 'missing' | 'replaced';

export interface OptimisticMutationOptions<TData, TResult> {
  /** Turn the server result into the confirmed value; defaults to re-applying `apply`. */
  confirm?: (result: TResult) => (data: TData) => TData;
  /** Revalidate the entry after the server call settles. */
  revalidate?: boolean;
}

/** Handle of an optimistic overlay that is settled later (see `beginOptimistic`). */
export interface ReplicaOptimisticToken<TData> {
  commit: (confirm?: (data: TData) => TData) => void;
  rollback: () => void;
}

/**
 * The replica engine: every transition of one resource, independent of any
 * UI framework or state library.
 *
 * It owns hydrate-if-empty, server replace, pagination, optimistic overlays
 * with commit/rollback, entity propagation, scope isolation and serialized
 * persistence. The host store keeps the rendered value (see
 * {@link ReplicaStorePort}); fetch scheduling (when to sync, dedupe, focus
 * revalidation) belongs to an adapter such as `@lobechat/replica/zustand`.
 */
export const createReplicaEngine = <TParams, TData, TFetched = TData>(
  resource: ReplicaResource<TParams, TData, TFetched>,
  options: ReplicaEngineOptions<TParams, TData, TFetched>,
) => {
  const { port } = options;
  const paging = resource.paging;
  const pagingCtx: ReplicaPagingContext<any> = { isClientOnly: options.isClientOnly };
  const prefix = options.actionPrefix ?? resource.name;
  const writeQueue = resource.storage ? new ReplicaWriteQueue<TData>(resource.storage) : undefined;
  const fetcher = options.fetcher ?? resource.fetcher;
  let mutationSeq = 0;
  /** Keys with a `loadMore` request in flight (the only valid `isLoadingMore`). */
  const loadingMore = new Set<string>();

  // ---- removal guard ----------------------------------------------------
  // An explicit removal (a deleted / unauthorized aggregate, or a subject whose
  // attachment is gone) drops the entry AND its persisted row — but a read of
  // that row that started before the removal still holds the old value, and a
  // removal leaves no trace in the slots for the `hydrate` guard to see. So a
  // scope+key is remembered as removed and refuses hydration until a server
  // value supersedes it, otherwise the late read resurrects the exact value the
  // removal just dropped.
  const removedEntries = createTombstones();
  /**
   * Keys whose persisted row delete was actually queued. `runEffects` refuses to
   * write while the scope is untrusted, so a removal made on a cold boot can arm
   * the guard without clearing the row. The guard alone must therefore not turn
   * a later removal into a no-op, or the stale row would survive and hydrate
   * again once the scope becomes trusted.
   */
  const purgedEntries = createTombstones();
  /**
   * Bumped on every removal of a scope+key. A network response whose request
   * started before the entry was removed (deleted, access revoked, pruned by an
   * authoritative parent list) must not `replace` it back: the slice records
   * the generation a request starts under and drops a response that crossed a
   * removal. Bounded like the tombstones; an evicted key reads 0, which only
   * ever drops a response (the next revalidate refetches), never admits one.
   */
  const removalGenerations = new Map<string, number>();
  const removalId = (scope: string, key: string) => `${scope}\u0000${key}`;
  const removalGeneration = (scope: string, key: string) =>
    removalGenerations.get(removalId(scope, key)) ?? 0;
  const markRemoved = (scope: string, key: string) => {
    removedEntries.add(scope, key);
    const id = removalId(scope, key);
    const next = (removalGenerations.get(id) ?? 0) + 1;
    // Re-insert so the map's insertion order is least-recently-removed first.
    removalGenerations.delete(id);
    removalGenerations.set(id, next);
    if (removalGenerations.size > DEFAULT_REMOVAL_TOMBSTONE_LIMIT)
      removalGenerations.delete(removalGenerations.keys().next().value as string);
  };
  const clearRemoved = (scope: string, key: string) => {
    removedEntries.clear(scope, key);
    purgedEntries.clear(scope, key);
  };
  const isRemoved = (scope: string, key: string) => removedEntries.has(scope, key);
  const markPurged = (scope: string, key: string) => purgedEntries.add(scope, key);
  const isPurged = (scope: string, key: string) => purgedEntries.has(scope, key);

  // ---- entity removal guards ---------------------------------------------
  // A hydrate that read its row before `removeEntity` patched storage still
  // holds the entity, so it is stripped from every value that hydrates while
  // such a read may be pending. A guard's lifetime follows the hydrates, not a
  // count: it is released once its storage patch landed (`releasedAt`) and is
  // dropped as soon as no hydrate that started before that point is pending.
  // So memory stays bounded by in-flight reads, and no guard a pending read
  // still needs is ever evicted. A patch that did not land is never released:
  // the unloaded row still holds the entity, so every later hydrate needs the
  // guard. A server value holding the entity again (restored) lifts it early.
  /** Logical clock shared by hydrate starts and guard releases. */
  let guardClock = 0;
  /** Start ticks of the hydrates in flight, per scope. */
  const pendingHydrates = new Map<string, Set<number>>();
  /** Removed entity ids per scope; `releasedAt` is unset until the storage patch landed. */
  const removedEntities = new Map<string, Map<string, { releasedAt?: number }>>();
  const removedIds = (scope: string) => [...(removedEntities.get(scope)?.keys() ?? [])];

  /** Drop the guards no pending hydrate of `scope` can still need. */
  const pruneEntityGuards = (scope: string) => {
    const guards = removedEntities.get(scope);
    if (!guards) return;
    let oldestPending = Infinity;
    for (const start of pendingHydrates.get(scope) ?? [])
      oldestPending = Math.min(oldestPending, start);
    for (const [id, guard] of guards)
      if (guard.releasedAt !== undefined && guard.releasedAt <= oldestPending) guards.delete(id);
    if (guards.size === 0) removedEntities.delete(scope);
  };

  // ---- resource-wide clear ----------------------------------------------
  /** Bumped by every `clear()` of a scope; reads started before it are stale. */
  const clearGenerations = new Map<string, number>();
  const clearGeneration = (scope: string) => clearGenerations.get(scope) ?? 0;
  /**
   * The persisted-row purge of the last `clear()` per scope: `true` once every
   * row delete landed. A hydrate waits for it, and refuses to read while the
   * purge failed (an untrusted scope, a storage error) so a wiped resource can
   * never paint a row that survived it.
   */
  const scopePurges = new Map<string, Promise<boolean>>();

  const getSlot = port.getState;
  const storageKey = (key: string, query?: string) => ({
    queryKey: replicaStorageKey(key, query),
  });

  const toPersisted = (data: TData): TData | null | undefined => {
    const paged = paging ? (toPersistedPage(data as any, paging, pagingCtx) as TData) : data;
    return options.toPersisted ? options.toPersisted(paged) : paged;
  };

  // ---- persisted-row index ---------------------------------------------
  // Storage has no key listing, so each scope keeps an index row of the
  // storage keys this resource persisted. Entity changes use it to patch rows
  // whose entry is not loaded in memory (e.g. a status update for a list the
  // user navigated away from), so a later visit never hydrates a stale value.
  const indexKey = (scope: string) => ({ queryKey: REPLICA_INDEX_KEY, scope });
  /** Keys known to be in the index row, per scope (skips redundant index writes). */
  const indexed = new Map<string, Set<string>>();

  /**
   * Latest queued write per row (`scope` + storage key), from one monotonic
   * counter. A confirmed delete only takes its key out of the index when no
   * later write re-created the row in the meantime.
   */
  const rowWrites = new Map<string, number>();
  let writeCounter = 0;
  const rowId = (scope: string, queryKey: string) => `${scope}\u0000${queryKey}`;
  const noteWrite = (scope: string, queryKey: string) => {
    const seq = ++writeCounter;
    rowWrites.set(rowId(scope, queryKey), seq);
    return seq;
  };

  // ---- last persisted value per row ---------------------------------------
  // What this session knows a row holds in storage: the value of its latest
  // write once that write is confirmed (`ReplicaStorage.set` resolved), or the
  // value read back by a hydrate no write raced. A write still in flight, or one
  // that failed, leaves the row unknown. A persist of a
  // deep-equal value is skipped — an unchanged revalidation must not rewrite
  // the same row. Every path that may change a row behind it (a delete, a
  // patch, a clear, an eviction) forgets the row, so the next persist writes.
  const storedValues = new Map<string, Map<string, unknown>>();
  const rememberStored = (scope: string, queryKey: string, data: unknown) => {
    const rows = storedValues.get(scope) ?? new Map<string, unknown>();
    storedValues.set(scope, rows);
    rows.set(queryKey, data);
  };
  const forgetStored = (scope: string, queryKeys: Iterable<string>) => {
    const rows = storedValues.get(scope);
    if (!rows) return;
    for (const queryKey of queryKeys) rows.delete(queryKey);
    if (rows.size === 0) storedValues.delete(scope);
  };
  const isStored = (scope: string, queryKey: string, data: unknown) => {
    const rows = storedValues.get(scope);
    return !!rows?.has(queryKey) && isEqual(rows.get(queryKey), data);
  };

  // ---- bounded persisted entries ----------------------------------------
  // With `persist.maxEntries`, the index is kept in least-recently-used order
  // (oldest first — the order an unbounded index is appended in, so rows an
  // earlier release indexed keep their place) and every use of a row moves it
  // to the end. Past the cap the oldest rows that nothing pins are evicted.
  const maxEntries = resource.maxPersistedEntries;
  /** Mounted readers per storage key and per entry key (see `retain`). */
  const retainedRows = new Map<string, number>();
  const retainedKeys = new Map<string, number>();
  /** Rows whose eviction delete is queued, per scope. */
  const evicting = new Map<string, Set<string>>();

  const bump = (counts: Map<string, number>, id: string, by: number) => {
    const next = (counts.get(id) ?? 0) + by;
    if (next > 0) counts.set(id, next);
    else counts.delete(id);
  };

  /**
   * Pin an entry (and the row of the query it asks for) while something shows
   * it: eviction never drops a retained row or the memory entry of a retained
   * key. `useSync` retains for as long as it is mounted. Returns the release.
   */
  const retain = (key: string, queryKey: string = replicaStorageKey(key)) => {
    bump(retainedKeys, key, 1);
    bump(retainedRows, queryKey, 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      bump(retainedKeys, key, -1);
      bump(retainedRows, queryKey, -1);
    };
  };

  /** Rows the memory of `scope` holds, by storage key → entry key. */
  const loadedRows = (scope: string) => {
    const slot = getSlot();
    const rows = new Map<string, string>();
    if (slot.scope !== scope) return rows;
    for (const [key, entry] of Object.entries(slot.entries))
      rows.set(replicaStorageKey(key, entry.query), key);
    return rows;
  };

  /** A row on screen, or whose entry has writes / a page load in flight. */
  const isPinned = (queryKey: string, entryKey: string | undefined) =>
    retainedRows.has(queryKey) ||
    (entryKey !== undefined &&
      (retainedKeys.has(entryKey) ||
        (getSlot().entries[entryKey]?.pending.length ?? 0) > 0 ||
        loadingMore.has(entryKey)));

  /** The oldest unpinned rows past the cap (`keys` is oldest first). */
  const pickEvictions = (scope: string, keys: string[], touched: string): string[] => {
    const going = evicting.get(scope);
    let excess = keys.length - maxEntries! - keys.filter((key) => going?.has(key)).length;
    if (excess <= 0) return [];
    const loaded = loadedRows(scope);
    const picked: string[] = [];
    for (const queryKey of keys) {
      if (excess <= 0) break;
      if (queryKey === touched || going?.has(queryKey)) continue;
      if (isPinned(queryKey, loaded.get(queryKey))) continue;
      picked.push(queryKey);
      excess -= 1;
    }
    return picked;
  };

  /**
   * Evict rows: drop the memory entries that answer them (one commit), then
   * delete the rows. A row leaves the index only once its delete landed, so a
   * failed eviction is picked again by a later use.
   */
  const evictRows = (scope: string, queryKeys: string[]) => {
    if (resource.scope.get() !== scope || !resource.scope.canPersist()) return;
    const going = evicting.get(scope) ?? new Set<string>();
    evicting.set(scope, going);
    const loaded = loadedRows(scope);
    // Re-check: a row may have been pinned since it was picked.
    const rows = queryKeys.filter(
      (queryKey) => !going.has(queryKey) && !isPinned(queryKey, loaded.get(queryKey)),
    );
    if (rows.length === 0) return;
    for (const queryKey of rows) going.add(queryKey);
    const dropped = rows.flatMap((queryKey) => {
      const key = loaded.get(queryKey);
      return key === undefined ? [] : [key];
    });
    if (dropped.length > 0) {
      const slot = getSlot();
      const entries = { ...slot.entries };
      for (const key of dropped) delete entries[key];
      port.commit(
        dropped.map((key) => ({ data: undefined, key })),
        { entries, scope },
        `${prefix}/evict`,
      );
    }
    void deleteRows(scope, rows).finally(() => {
      for (const queryKey of rows) going.delete(queryKey);
      if (going.size === 0 && evicting.get(scope) === going) evicting.delete(scope);
    });
  };

  /**
   * A bounded resource used a row: move it to the end of the index and evict
   * past the cap. No-op for an unbounded resource.
   */
  const touchStorageKey = (scope: string, queryKey: string) => {
    if (!writeQueue || maxEntries === undefined) return;
    const known = indexed.get(scope) ?? new Set<string>();
    indexed.set(scope, known);
    known.add(queryKey);
    let picked: string[] = [];
    void writeQueue
      .update(
        indexKey(scope),
        (current) => {
          const keys = (current?.data as unknown as string[] | undefined) ?? [];
          const next = [...keys.filter((key) => key !== queryKey), queryKey];
          picked = pickEvictions(scope, next, queryKey);
          if (keys.length === next.length && keys.at(-1) === queryKey) return undefined;
          return { data: next as unknown as TData, updatedAt: Date.now() };
        },
        { read: 'prefer-strict' },
      )
      .then((touched) => {
        // Unreadable index: leave it untouched, retry the append on the next use.
        if (!touched) return void known.delete(queryKey);
        if (picked.length > 0) evictRows(scope, picked);
      });
  };

  /** Record a persisted row in the index (queued after the row write). */
  const trackStorageKey = (scope: string, queryKey: string) => {
    if (!writeQueue) return;
    noteWrite(scope, queryKey);
    if (maxEntries !== undefined) return touchStorageKey(scope, queryKey);
    const known = indexed.get(scope) ?? new Set<string>();
    indexed.set(scope, known);
    if (known.has(queryKey)) return;
    known.add(queryKey);
    void writeQueue
      .update(
        indexKey(scope),
        (current) => {
          const keys = new Set((current?.data as unknown as string[] | undefined) ?? []);
          if (keys.has(queryKey)) return undefined;
          keys.add(queryKey);
          return { data: [...keys] as unknown as TData, updatedAt: Date.now() };
        },
        { read: 'prefer-strict' },
      )
      // An unreadable index is left untouched (never rewritten as just this
      // key); forget the key so the next write of the row retries the append.
      .then((tracked) => {
        if (!tracked) known.delete(queryKey);
      });
  };

  /**
   * Read the index for a destructive pass (remove / clear / entity patch).
   * Uses the storage's strict read when it has one, so an unreadable index
   * rejects instead of looking empty — a purge must never report success for
   * rows it could not enumerate.
   */
  const readIndex = async (scope: string): Promise<string[]> => {
    // A storage without `getStrict` rejects here: its `get` cannot tell an
    // unreadable index from an empty one.
    const row = await readReplicaRowStrict(resource.storage!, indexKey(scope));
    return (row?.data as unknown as string[] | undefined) ?? [];
  };

  /**
   * Drop storage keys from the index (both the session's view of it and the
   * persisted row, which may list keys this session never wrote).
   */
  const untrackStorageKeys = (scope: string, queryKeys: string[]) => {
    if (!writeQueue || queryKeys.length === 0) return;
    const known = indexed.get(scope);
    for (const queryKey of queryKeys) known?.delete(queryKey);
    const dropped = new Set(queryKeys);
    writeQueue.update(
      indexKey(scope),
      (current) => {
        const keys = (current?.data as unknown as string[] | undefined) ?? [];
        const next = keys.filter((queryKey) => !dropped.has(queryKey));
        if (!current || next.length === keys.length) return undefined;
        return { data: next as unknown as TData, updatedAt: Date.now() };
      },
      { read: 'prefer-strict' },
    );
  };

  /** Take rows whose delete landed out of the index, unless rewritten since. */
  const confirmDeleted = (scope: string, deleted: [queryKey: string, seq: number][]) => {
    const gone = deleted
      .filter(([queryKey, seq]) => rowWrites.get(rowId(scope, queryKey)) === seq)
      .map(([queryKey]) => queryKey);
    for (const queryKey of gone) rowWrites.delete(rowId(scope, queryKey));
    untrackStorageKeys(scope, gone);
  };

  /**
   * Queue row deletes now (ordered before any later write to the same rows).
   * A key leaves the index only once its delete is confirmed: a failed delete
   * stays indexed, so the next `remove` / `clear` finds and retries it.
   * Resolves `true` when every delete landed.
   */
  const deleteRows = (scope: string, queryKeys: string[]): Promise<boolean> => {
    const queue = writeQueue!;
    forgetStored(scope, queryKeys);
    const queued = queryKeys.map((queryKey) => {
      const seq = noteWrite(scope, queryKey);
      return queue
        .remove({ queryKey, scope })
        .then((removed): [string, number] | undefined => (removed ? [queryKey, seq] : undefined));
    });
    return Promise.all(queued).then((results) => {
      confirmDeleted(
        scope,
        results.filter((result): result is [string, number] => !!result),
      );
      return results.every(Boolean);
    });
  };

  /**
   * Delete every persisted row of entry `key` in `scope` — `current` (the row
   * memory knows about, queued right away so it orders before any later write)
   * plus every other query variant the index lists. Resolves `true` once all
   * deletes landed.
   */
  const removeStoredVariants = (scope: string, key: string, current: string) => {
    const first = deleteRows(scope, [current]);
    const rest = readIndex(scope).then(
      (persisted) => {
        // A server value that superseded the removal while the index was read
        // owns its (fresh) row: keep it, delete only the stale variants.
        const slot = getSlot();
        const live = !isRemoved(scope, key) && slot.scope === scope ? slot.entries[key] : undefined;
        const liveKey = live && replicaStorageKey(key, live.query);
        const variants = new Set(
          [...(indexed.get(scope) ?? []), ...persisted].filter(
            (queryKey) =>
              queryKey !== current && queryKey !== liveKey && isReplicaStorageKeyOf(queryKey, key),
          ),
        );
        return variants.size === 0 ? true : deleteRows(scope, [...variants]);
      },
      () => false,
    );
    return Promise.all([first, rest]).then((results) => results.every(Boolean));
  };

  const runEffects = (effects: ReplicaEffect<TData>[]) => {
    if (!writeQueue || effects.length === 0) return;
    // Until identity resolves the scope is a guess; never write into it.
    if (!resource.scope.canPersist()) return;
    for (const effect of effects) {
      if (!resource.persistKey(effect.key)) continue;
      const key = { ...storageKey(effect.key, effect.query), scope: effect.scope };
      if (effect.type === 'remove') {
        // A repeated removal for this key can be a real no-op (see `remove`) —
        // but only once the row delete actually landed. A storage that rejects
        // the delete (a closed IndexedDB, a quota error) must leave the key
        // unpurged, so the next terminal answer retries it instead of letting a
        // stale row survive to hydrate again.
        // Every query variant goes: a row persisted under other filters would
        // otherwise hydrate the removed entry once the guard is superseded.
        void removeStoredVariants(effect.scope, effect.key, key.queryKey).then((removed) => {
          if (removed) markPurged(effect.scope, effect.key);
        });
        continue;
      }
      const data = toPersisted(effect.data);
      if (data === undefined) continue;
      if (data === null) {
        // Server-confirmed absence: remove the prior projection rather than
        // leaving it to be hydrated as if the value were still current.
        void deleteRows(effect.scope, [key.queryKey]);
        continue;
      }
      // The row already holds this value: an unchanged revalidation is no write.
      if (isStored(effect.scope, key.queryKey, data)) {
        touchStorageKey(effect.scope, key.queryKey);
        continue;
      }
      // Until this write is confirmed the row's content is unknown: forget what
      // it held, and only remember `data` once the write observably landed and
      // is still the latest queued for the row. A failed (or best-effort,
      // silently dropped) write therefore never makes a later identical persist
      // look redundant — that one writes again.
      forgetStored(effect.scope, [key.queryKey]);
      trackStorageKey(effect.scope, key.queryKey);
      const id = rowId(effect.scope, key.queryKey);
      const seq = rowWrites.get(id);
      void writeQueue.set(key, { data, updatedAt: Date.now() }).then((written) => {
        if (written && rowWrites.get(id) === seq) rememberStored(effect.scope, key.queryKey, data);
      });
    }
  };

  /** Read an entry as it will be once `writes` are applied (latest write wins). */
  const readThrough = (writes: ReplicaViewWrite<TData>[], key: string): TData | undefined => {
    for (let i = writes.length - 1; i >= 0; i--) {
      const write = writes[i];
      if ('type' in write) return undefined;
      if (write.key === key) return write.data;
    }
    return port.read(key);
  };

  const dispatch = (action: ReplicaAction<TData>): boolean => runActions([action]);

  /**
   * Fold one or more actions into a single host commit. A caller that seeds
   * many keys (a list refresh) must not clone the view and notify subscribers
   * once per key; every action is still reduced in order, and the accumulated
   * writes are applied as ONE host update. A batch is dropped whole when any
   * action belongs to another identity (see {@link dispatch}).
   */
  function runActions(actions: ReplicaAction<TData>[]): boolean {
    if (actions.length === 0) return false;
    const activeScope = resource.scope.get();
    // An action captured under another identity is stale — drop it.
    if (actions.some((action) => action.scope !== activeScope)) return false;

    for (const action of actions) {
      // Every removal path (explicit `remove`, a missing response, an entity that
      // takes its whole value with it) arms the hydration guard for this key.
      if (action.type === 'remove') markRemoved(action.scope, action.key);
      // A replacement that reaches the active scope supersedes an earlier
      // removal, so the key may hydrate again. A response captured under another
      // scope is dropped above and must NOT clear its guard: the removal still
      // stands for its own scope, whose row delete may be pending or may have failed.
      if (action.type === 'replace') clearRemoved(action.scope, action.key);
    }

    const initial = getSlot();
    let slot = initial;
    const writes: ReplicaViewWrite<TData>[] = [];
    const effects: ReplicaEffect<TData>[] = [];
    const read = (key: string) => readThrough(writes, key);
    if (slot.scope !== undefined && slot.scope !== activeScope) {
      // Memory moves to another identity; what we knew of its rows can go.
      storedValues.delete(slot.scope);
      const reset = replicaReducer(slot, { scope: activeScope, type: 'resetScope' }, read);
      writes.push(...reset.writes);
      slot = reset.state;
    }

    let changed = false;
    for (const action of actions) {
      const transition = replicaReducer(slot, action, read);
      writes.push(...transition.writes);
      effects.push(...transition.effects);
      // The reducer returns the entry's state unchanged for a no-op.
      if (transition.state !== slot) {
        slot = transition.state;
        changed = true;
      }
    }

    if (!changed && writes.length === 0 && slot === initial) return false;
    port.commit(writes, slot, `${prefix}/${actions.length > 1 ? 'batch' : actions[0].type}`);
    runEffects(effects);
    return true;
  }

  /**
   * Drop memory owned by another identity as soon as a new scope is active —
   * even when the new scope has nothing persisted and its fetch is slow, the
   * previous user's / workspace's rows must not stay on screen.
   */
  const ensureScope = (scope: string) => {
    if (scope === resource.scope.get() && getSlot().scope !== scope)
      dispatch({ scope, type: 'resetScope' });
  };

  const getConfirmed = (key: string): TData | undefined => {
    const entry = getSlot().entries[key];
    return entry?.pending.length ? entry.base : port.read(key);
  };

  /**
   * An overwrite hydrate repaints the entry from another query's persisted page.
   * Client-only rows (an in-flight upload / create) have no server row yet, so
   * that page cannot contain them — keep the ones still in the view, so a
   * same-pool query change (a re-sort, a view-mode switch) never drops them.
   * A cross-pool navigate is not "client-only" for the new params and is dropped.
   */
  const keepClientOnlyRows = (incoming: TData, current: TData | undefined): TData => {
    if (!paging || !options.isClientOnly || !current) return incoming;
    const page = incoming as unknown as ReplicaPagedData<unknown, unknown>;
    const currentItems = (current as unknown as ReplicaPagedData<unknown, unknown>).items ?? [];
    const incomingIds = new Set(page.items.map((item) => paging.getId(item)));
    const survivors = currentItems.filter(
      (item) => options.isClientOnly!(item) && !incomingIds.has(paging.getId(item)),
    );
    if (survivors.length === 0) return incoming;
    const items =
      paging.direction === 'forward'
        ? [...survivors, ...page.items]
        : [...page.items, ...survivors];
    return { ...(incoming as object), items } as TData;
  };

  const hydrate = async (
    params: TParams,
    scope = resource.scope.get(),
    { overwrite = false }: { overwrite?: boolean } = {},
  ) => {
    if (!resource.storage) return false;
    // An identity-less runtime reads network-only: its scope is a guess, so
    // hydrating it could paint another session's private rows.
    if (resource.scope.canHydrate && !resource.scope.canHydrate()) return false;
    const key = resource.key(params);
    if (!resource.persistKey(key)) return false;
    // A removed entry is not read back: only a later server value supersedes
    // the removal (see `replace`), so a stale row can never repaint it.
    if (isRemoved(scope, key)) return false;
    // Pending until settled: entity guards outlive every read that may hold them.
    const start = ++guardClock;
    const pending = pendingHydrates.get(scope) ?? new Set<number>();
    pendingHydrates.set(scope, pending);
    pending.add(start);
    try {
      return await readAndHydrate(params, key, scope, overwrite);
    } finally {
      pending.delete(start);
      if (pending.size === 0) pendingHydrates.delete(scope);
      pruneEntityGuards(scope);
    }
  };

  const readAndHydrate = async (
    params: TParams,
    key: string,
    scope: string,
    overwrite: boolean,
  ) => {
    const storage = resource.storage!;
    // A read started before a `clear()` of this scope holds a wiped row.
    const generation = clearGeneration(scope);
    // After a `clear()`, read only once its row deletes landed.
    const purge = scopePurges.get(scope);
    if (purge && !(await purge)) return false;
    const query = resource.query(params);
    const { queryKey } = storageKey(key, query);
    const writesBefore = writeCounter;
    const cached = await storage.get({ queryKey, scope });
    if (!cached) return false;
    // Re-check after the read: a removal or a clear that landed while it was in
    // flight must not resurrect the row it just dropped.
    if (isRemoved(scope, key) || clearGeneration(scope) !== generation) return false;
    // The row holds what was read, unless a write was queued while reading.
    if (writeCounter === writesBefore && !storedValues.get(scope)?.has(queryKey))
      rememberStored(scope, queryKey, cached.data);
    if (options.isHydratable && !options.isHydratable(cached.data, params)) return false;
    // Entities deleted while the read was in flight may still be in the row.
    const stored = withoutRemovedEntities(scope, cached.data);
    if (stored === undefined) return false;
    const data = overwrite ? keepClientOnlyRows(stored, port.read(key)) : stored;
    const applied = dispatch({
      data,
      key,
      overwrite,
      params,
      query,
      scope,
      type: 'hydrate',
      updatedAt: cached.updatedAt,
    });
    // A hydrated row is a used row (bounded resources keep LRU order).
    if (applied && resource.scope.canPersist()) touchStorageKey(scope, queryKey);
    return applied;
  };

  const viewMatchesFields = (current: TData | undefined, params: TParams) => {
    const fields = options.viewFields?.(params);
    if (!current || !fields) return true;
    // Falsy descriptors (undefined / false / null) are equivalent.
    const norm = (value: unknown) => stableQueryKey(value || null);
    return Object.entries(fields).every(
      ([field, value]) => norm(value) === norm((current as Record<string, unknown>)[field]),
    );
  };

  /** Non-paged: whether a (prepared) head response is a terminal absence (`isMissing`). */
  const isMissingHead = (incoming: TFetched): boolean => !paging && !!options.isMissing?.(incoming);

  const mergeHead = (
    key: string,
    incoming: TFetched,
    confirmed: TData | undefined,
    params: TParams,
    reset: boolean,
  ) => {
    const page = incoming as unknown as ReplicaPageResult<unknown, unknown>;
    const pageSize = (params as { pageSize?: number }).pageSize ?? page.items.length;
    const merged = {
      ...applyHeadPage(confirmed as any, page, { pageSize, reset }, paging!, pagingCtx),
      ...options.viewFields?.(params),
      isLoadingMore: loadingMore.has(key),
    };
    // Keep domain-only fields of the current view (e.g. transient flags).
    const next = { ...(confirmed as object), ...merged } as TData;
    return confirmed !== undefined && isEqual(next, confirmed) ? undefined : next;
  };

  /**
   * Fold a head response in and report what it was: dropped by `prepareHead`,
   * a terminal absence (`isMissing`, applied as a removal) or a replacement.
   * `changed` is whether the store moved. `replace` is the boolean shorthand;
   * the zustand slice's settle pipeline reads the outcome to pick its effects.
   */
  const applyHead = (
    params: TParams,
    fetched: TFetched,
    scope = resource.scope.get(),
  ): { changed: boolean; outcome: ReplicaHeadOutcome } => {
    const key = resource.key(params);
    const incoming = options.prepareHead
      ? options.prepareHead(fetched, port.read(key), params)
      : fetched;
    if (incoming === undefined) return { changed: false, outcome: 'dropped' };
    // A response that says the entry is gone clears it outright: the merge path
    // would keep — and re-persist — the confirmed value it is replacing. It also
    // arms the hydration guard, so a persisted read still in flight cannot bring
    // the dropped value back.
    if (isMissingHead(incoming)) {
      // Route through `remove` so a repeated "missing" is a no-op and a response
      // captured under another scope is dropped rather than applied here.
      return { changed: remove(key, scope), outcome: 'missing' };
    }
    const query = resource.query(params);
    const entry = getSlot().entries[key];
    // A different query (filters, sort) must not merge with loaded pages. A
    // view seeded without bookkeeping is compared by its `viewFields`.
    const reset = entry
      ? entry.query !== query
      : paging !== undefined && !viewMatchesFields(port.read(key), params);
    const applied = dispatch({
      data: (confirmed) =>
        paging
          ? mergeHead(key, incoming, confirmed, params, reset)
          : options.merge
            ? options.merge(incoming, confirmed, params)
            : (incoming as unknown as TData),
      key,
      params,
      query,
      scope,
      type: 'replace',
    });
    if (applied) forgetRestoredEntities(scope, getConfirmed(key));
    return { changed: applied, outcome: 'replaced' };
  };

  const replace = (params: TParams, fetched: TFetched, scope = resource.scope.get()) =>
    applyHead(params, fetched, scope).changed;

  /**
   * Confirmed local write: patches the view (and the base under any overlay).
   * Pass `source: 'seed'` for a provisional row (a list row standing in for a
   * detail): it is hydratable and never persisted, so the authoritative value it
   * stands in for is preserved (see `ReplicaSource`).
   */
  const update = (
    key: string,
    apply: (data: TData | undefined) => TData | undefined,
    {
      persist = true,
      seedTag,
      source,
    }: { persist?: boolean; seedTag?: string; source?: ReplicaSource } = {},
  ) =>
    dispatch({ apply, key, persist, scope: resource.scope.get(), seedTag, source, type: 'update' });

  /**
   * Confirmed local write to several keys as ONE host update — same per-key
   * semantics as {@link update}, but a whole list seeds in a single commit
   * instead of one per row (no repeated view cloning or subscriber churn).
   */
  const updateMany = (
    entries: { apply: (data: TData | undefined) => TData | undefined; key: string }[],
    {
      persist = true,
      seedTag,
      source,
    }: { persist?: boolean; seedTag?: string; source?: ReplicaSource } = {},
  ) => {
    const scope = resource.scope.get();
    return runActions(
      entries.map(({ apply, key }) => ({
        apply,
        key,
        persist,
        scope,
        seedTag,
        source,
        type: 'update' as const,
      })),
    );
  };

  /**
   * Purge a removal that belongs to a scope which is no longer active.
   *
   * The in-memory view is not ours to touch — the active scope owns it — but the
   * guard and the persisted row both belong to THAT scope. Arming the one and
   * deleting the other keeps a switch back from hydrating a value the server
   * just deleted or denied. `dispatch` would reject the off-scope action
   * outright (see `replace`'s stale-scope guard), so the row would otherwise
   * survive untouched.
   *
   * Like `remove`, the delete only counts as done once it was actually queued:
   * an untrusted scope refuses writes, so the guard stays armed as `unpurged`
   * and a later removal retries instead of reporting a no-op that never deletes.
   */
  const purge = (key: string, scope: string): boolean => {
    if (isRemoved(scope, key) && isPurged(scope, key)) return false;
    markRemoved(scope, key);
    // Nothing persisted (no storage, or a key this resource never persists) is
    // already "cleared": the guard alone is the whole purge.
    if (!writeQueue || !resource.persistKey(key)) {
      markPurged(scope, key);
      return false;
    }
    if (!resource.scope.canPersist()) return false;
    void removeStoredVariants(scope, key, storageKey(key).queryKey).then((removed) => {
      if (removed) markPurged(scope, key);
    });
    return true;
  };

  /**
   * Drop an entry and its persisted row.
   *
   * A removal is a no-op only once there is genuinely nothing left to do: the
   * key is guarded, its value is gone, AND its stale row was already scheduled
   * for deletion (or there is no persisted row to clear). A subject with no
   * acceptance polls `null` every couple of seconds, and re-emitting the same
   * delete on every tick would only churn storage. But a removal whose delete
   * was skipped — an untrusted scope refuses writes — keeps retrying, so the row
   * cannot survive to hydrate again once the scope is trusted.
   *
   * A removal captured under another identity (a late NOT_FOUND arriving after a
   * workspace switch) is routed to {@link purge}: it must not touch the scope on
   * screen, yet its own scope's row still has to go.
   */
  const remove = (key: string, scope: string = resource.scope.get()): boolean => {
    if (scope !== resource.scope.get()) return purge(key, scope);
    // Nothing persisted (no storage, or a key this resource never persists) is
    // already "cleared"; otherwise the row delete must have been queued.
    const rowCleared = !writeQueue || !resource.persistKey(key) || isPurged(scope, key);
    if (rowCleared && isRemoved(scope, key) && port.read(key) === undefined) return false;
    return dispatch({ key, scope, type: 'remove' });
  };

  /**
   * Persist the confirmed value of an entry as it is now — the flush after a
   * burst of in-memory `update(..., { persist: false })` writes (a stream).
   */
  const persist = (key: string) => {
    const scope = resource.scope.get();
    if (getSlot().scope !== undefined && getSlot().scope !== scope) return;
    const data = getConfirmed(key);
    if (data === undefined) return;
    runEffects([{ data, key, query: getSlot().entries[key]?.query, scope, type: 'persist' }]);
  };

  /**
   * Wipe the resource in the active scope: every entry leaves memory in one
   * host commit, every persisted row (all keys, all query variants) and the
   * index are deleted, and reads already in flight are dropped — a hydrate
   * started before the clear never dispatches, and `useSync` discards head
   * responses whose request started before it. Requests started afterwards
   * apply normally. Resolves `true` once the persisted rows are gone.
   */
  const clear = (): Promise<boolean> => {
    const scope = resource.scope.get();
    clearGenerations.set(scope, clearGeneration(scope) + 1);
    port.commit([{ type: 'clear' }], { entries: {}, scope }, `${prefix}/clear`);
    storedValues.delete(scope);
    const purge = purgeScope(scope);
    scopePurges.set(scope, purge);
    return purge;
  };

  /**
   * `clear()` for any scope, including one that is not active (a user who
   * switched away while their data was being deleted): every persisted row of
   * `scope` and its index go, and for the active scope memory is wiped too
   * (exactly `clear()`). An inactive scope's memory is not on screen and is
   * left alone. The row deletes go through the write queue, so they land after
   * any write this session already queued for that scope — a row (or index
   * entry) written just before is purged rather than landing after the purge.
   * A later hydrate of `scope` waits for the purge. Resolves `true` once the
   * persisted rows are gone.
   */
  const clearScope = (scope: string): Promise<boolean> => {
    if (scope === resource.scope.get()) return clear();
    clearGenerations.set(scope, clearGeneration(scope) + 1);
    const purge = purgeScope(scope);
    scopePurges.set(scope, purge);
    return purge;
  };

  /** Delete every persisted row of `scope` (see `clear`). */
  const purgeScope = async (scope: string): Promise<boolean> => {
    if (!writeQueue) return true;
    // Until identity resolves the scope is a guess; never write into it.
    if (!resource.scope.canPersist()) return false;
    // Rows this session knows about are queued now, ahead of any later write.
    const queued = deleteRows(scope, [...(indexed.get(scope) ?? [])]);
    let persisted: string[];
    try {
      persisted = await readIndex(scope);
    } catch {
      return false;
    }
    // Keys this session tracks are already queued above, or were written by a
    // newer response since the clear (their row is fresh): skip both.
    const known = indexed.get(scope);
    const stale = persisted.filter((queryKey) => !known?.has(queryKey));
    const [first, rest] = await Promise.all([queued, deleteRows(scope, stale)]);
    return first && rest;
  };

  const revalidate = (key?: string): Promise<unknown> =>
    options.revalidate ? options.revalidate(key) : Promise.resolve();

  /**
   * Start an optimistic overlay now and settle it later (multi-resource flows).
   * `query` tags the overlay with the query it describes; a caller that knows
   * the requested query (e.g. before the first page painted) should pass it, so
   * the overlay is scoped to that query rather than kept across every change.
   */
  const beginOptimistic = (
    key: string,
    apply: (data: TData) => TData,
    query?: string,
  ): ReplicaOptimisticToken<TData> => {
    const scope = resource.scope.get();
    const id = ++mutationSeq;
    // Tag the overlay with the query it describes: the entry may move on to
    // another query (or another query may reuse the key) before it settles.
    dispatch({
      apply,
      id,
      key,
      query: query ?? getSlot().entries[key]?.query,
      scope,
      type: 'optimistic',
    });
    return {
      commit: (confirm) => {
        dispatch({ confirm, id, key, scope, type: 'commit' });
      },
      rollback: () => {
        dispatch({ id, key, scope, type: 'rollback' });
      },
    };
  };

  /**
   * Apply `apply` to the view right away, run `serverCall`, then commit (the
   * confirmed value is persisted) or roll back (the view is rebuilt from the
   * confirmed base plus any other in-flight overlays) and rethrow.
   */
  const optimistic = async <TResult>(
    key: string,
    apply: (data: TData) => TData,
    serverCall: () => Promise<TResult>,
    mutationOptions: OptimisticMutationOptions<TData, TResult> = {},
  ): Promise<TResult> => {
    const token = beginOptimistic(key, apply);
    try {
      const result = await serverCall();
      token.commit(mutationOptions.confirm?.(result));
      return result;
    } catch (error) {
      token.rollback();
      throw error;
    } finally {
      if (mutationOptions.revalidate) void revalidate(key);
    }
  };

  // ---- pagination --------------------------------------------------------

  /**
   * Fetch and merge the next page with the params of the loaded head page
   * (`fallbackParams` covers views seeded outside `useSync`). In `cursor` mode
   * paging only starts from a server-confirmed head page: a hydrated cursor
   * may be stale. A result is dropped when the scope, the query or the loaded
   * depth changed while it was in flight.
   */
  const loadMore = async (key: string, fallbackParams?: TParams): Promise<void> => {
    if (!paging || !fetcher) return;
    const entry = getSlot().entries[key];
    const current = port.read(key) as ReplicaPagedData<unknown, unknown> | undefined;
    if (!current || loadingMore.has(key)) return;
    if (paging.mode === 'cursor' && entry?.source === 'storage') return;
    const params = (entry?.params ?? fallbackParams) as TParams | undefined;
    if (params === undefined) return;
    const cursor = getNextPageCursor(current, paging);
    if (cursor === null || cursor === undefined) return;

    const query = entry?.query;
    const scope = resource.scope.get();
    const depth = current.currentPage;
    const setLoading = (patch: object) =>
      update(key, (data) => data && ({ ...data, ...patch } as TData), { persist: false });

    loadingMore.add(key);
    setLoading({ isLoadingMore: true, loadMoreError: undefined });
    const isCurrent = () => {
      const latest = port.read(key) as ReplicaPagedData<unknown, unknown> | undefined;
      return (
        resource.scope.get() === scope &&
        getSlot().entries[key]?.query === query &&
        latest?.currentPage === depth
      );
    };
    try {
      const page = (await fetcher(params, cursor)) as unknown as ReplicaPageResult<
        unknown,
        unknown
      >;
      if (!isCurrent()) return void setLoading({ isLoadingMore: false });
      update(
        key,
        (data) => data && (applyNextPage(data as any, page, paging, pagingCtx) as TData),
        { persist: (paging.persist?.pages ?? 1) > 1 },
      );
    } catch (error) {
      setLoading({ isLoadingMore: false, loadMoreError: isCurrent() ? error : undefined });
    } finally {
      loadingMore.delete(key);
    }
  };

  /** Insert rows at the head (new / streamed items). */
  const insertHead = <TItem>(key: string, items: TItem[], { persist = false } = {}) =>
    paging
      ? update(key, (data) => data && (insertHeadItems(data as any, items, paging) as TData), {
          persist,
        })
      : false;

  /** Drop loaded pages, keeping the head (e.g. after an edit inside older pages). */
  const collapse = (key: string) =>
    paging
      ? update(key, (data) => data && (collapseToHead(data as any, paging) as TData), {
          persist: false,
        })
      : false;

  // ---- entity propagation -----------------------------------------------

  const entityKeys = (id: string): string[] => {
    const keys = port.keys?.() ?? Object.keys(getSlot().entries);
    return keys.filter((key) => {
      const data = port.read(key);
      if (data === undefined) return false;
      if (paging) return hasPagedItem(data as any, id, paging);
      return options.entity ? options.entity.has(data, id) : false;
    });
  };

  /** Map one entity inside a value; `undefined` means the whole value goes away. */
  const mapEntity = <TItem>(
    data: TData,
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): TData | undefined => {
    if (paging) return mapPagedItem(data as any, id, fn as any, paging) as TData;
    const entity = options.entity;
    if (!entity || !entity.has(data, id)) return data;
    return entity.map(data, id, fn);
  };

  /** Which of `ids` are held by `data`. */
  const heldEntities = (data: TData, ids: string[]): string[] => {
    if (paging) {
      const items = (data as unknown as ReplicaPagedData<unknown, unknown>).items ?? [];
      const present = new Set(items.map((item) => paging.getId(item)));
      return ids.filter((id) => present.has(id));
    }
    const entity = options.entity;
    return entity ? ids.filter((id) => entity.has(data, id)) : [];
  };

  /** Strip entities removed in `scope` from a value read back from storage. */
  const withoutRemovedEntities = (scope: string, data: TData): TData | undefined => {
    const removed = removedIds(scope);
    if (removed.length === 0) return data;
    let next: TData | undefined = data;
    for (const id of heldEntities(data, removed)) {
      next = mapEntity(next!, id, () => undefined);
      if (next === undefined) break;
    }
    return next;
  };

  /** A server value holding a removed entity again (restored) lifts its guard. */
  const forgetRestoredEntities = (scope: string, data: TData | undefined) => {
    const removed = removedIds(scope);
    if (removed.length === 0 || data === undefined) return;
    const guards = removedEntities.get(scope)!;
    for (const id of heldEntities(data, removed)) guards.delete(id);
    if (guards.size === 0) removedEntities.delete(scope);
  };

  /**
   * Apply an entity change to persisted rows that memory does not hold (the
   * memory path already persists loaded entries). Read-modify-write runs in
   * the per-key write queue, so it sees every earlier write; a missing row is
   * never recreated. Resolves once the patches have settled: `true` when every
   * unloaded row is known to be patched (or nothing is persisted), `false` when
   * a row may still hold the old entity (untrusted scope, unreadable index or
   * row, a failed write, an identity switch mid-pass).
   */
  const patchStoredEntityRows = async <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    scope: string = resource.scope.get(),
  ): Promise<boolean> => {
    if (!writeQueue) return true;
    if (!resource.scope.canPersist()) return false;
    // A scope left behind is patched on purpose: nothing of it is loaded, and an
    // identity switch while reading its index does not make its rows foreign.
    const offScope = scope !== resource.scope.get();
    const slot = getSlot();
    // Rows memory holds are patched through memory — but only in the active
    // scope; a view still showing a scope left behind is not what it persists.
    const loaded = new Set(
      !offScope && slot.scope === scope
        ? Object.entries(slot.entries).map(([key, entry]) => storageKey(key, entry.query).queryKey)
        : [],
    );
    let keys: string[];
    try {
      keys = await readIndex(scope);
    } catch (error) {
      // Rows cannot be enumerated: nothing to patch. Loaded entries are already
      // updated, and a removal keeps guarding later hydrates (`removeEntity`).
      console.error(`[replica:${resource.name}] failed to read the persisted index`, error);
      return false;
    }
    // Identity changed while reading the index: those rows are not ours to touch.
    if (!offScope && resource.scope.get() !== scope) return false;
    // Rows this session wrote to the scope may not be in the persisted index yet
    // (their row or index write is still queued — e.g. just before an account
    // switch). Patch them too: each patch is queued behind the row's own write,
    // so it reads the row once that write landed.
    for (const queryKey of indexed.get(scope) ?? [])
      if (!keys.includes(queryKey)) keys.push(queryKey);
    const patches: Promise<boolean>[] = [];
    for (const queryKey of keys) {
      if (loaded.has(queryKey)) continue;
      const seq = noteWrite(scope, queryKey);
      forgetStored(scope, [queryKey]);
      let dropped = false;
      const patch = writeQueue
        .update(
          { queryKey, scope },
          (current) => {
            if (!current) return undefined;
            const next = mapEntity(current.data, id, fn);
            if (next === current.data) return undefined;
            if (next === undefined) {
              dropped = true;
              return null;
            }
            return { data: next, updatedAt: Date.now() };
          },
          { read: 'strict' },
        )
        .then((written) => {
          if (written && dropped) confirmDeleted(scope, [[queryKey, seq]]);
          return written;
        });
      patches.push(patch);
    }
    return (await Promise.all(patches)).every(Boolean);
  };

  const patchStoredEntity = async <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): Promise<void> => {
    await patchStoredEntityRows(id, fn);
  };

  /**
   * Read-modify-write the persisted rows memory does not hold, keyed by row
   * rather than by entity: a cached list for a folder the user is not viewing
   * gets its projection patched in the per-key write queue, so a later visit
   * hydrates the reconciled value instead of a stale page. `fn` returns the
   * next data, the same reference (or `undefined`) to skip, or `null` to drop
   * the row. Runs in the write queue, so it sees every earlier write.
   */
  const patchStoredRows = async (fn: (data: TData) => TData | null | undefined): Promise<void> => {
    if (!writeQueue || !resource.scope.canPersist()) return;
    const scope = resource.scope.get();
    const slot = getSlot();
    const loaded = new Set(
      slot.scope === scope
        ? Object.entries(slot.entries).map(([key, entry]) => storageKey(key, entry.query).queryKey)
        : [],
    );
    let keys: string[];
    try {
      keys = await readIndex(scope);
    } catch (error) {
      console.error(`[replica:${resource.name}] failed to read the persisted index`, error);
      return;
    }
    // Identity changed while reading the index: those rows are not ours to touch.
    if (resource.scope.get() !== scope) return;
    const patches: Promise<void>[] = [];
    for (const queryKey of keys) {
      if (loaded.has(queryKey)) continue;
      const seq = noteWrite(scope, queryKey);
      forgetStored(scope, [queryKey]);
      let dropped = false;
      const patch = writeQueue
        .update(
          { queryKey, scope },
          (current) => {
            if (!current) return undefined;
            const next = fn(current.data);
            if (next === current.data || next === undefined) return undefined;
            if (next === null) {
              dropped = true;
              return null;
            }
            return { data: next, updatedAt: Date.now() };
          },
          { read: 'strict' },
        )
        .then((written) => {
          if (written && dropped) confirmDeleted(scope, [[queryKey, seq]]);
        });
      patches.push(patch);
    }
    await Promise.all(patches);
  };

  /**
   * `updateEntity`, returning the persisted-row patch (if any) to wait on —
   * `true` once every unloaded row is patched.
   */
  const applyEntity = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    { persist = true }: { persist?: boolean } = {},
  ): Promise<boolean> | undefined => {
    const patch = persist ? patchStoredEntityRows(id, fn) : undefined;
    for (const key of entityKeys(id)) {
      const current = port.read(key);
      if (current === undefined) continue;
      const next = mapEntity(current, id, fn);
      if (next === undefined) remove(key);
      else
        update(key, (data) => (data === undefined ? data : (mapEntity(data, id, fn) ?? data)), {
          persist,
        });
    }
    return patch;
  };

  /**
   * An entity patch started for a scope that was not active settled. If the
   * user switched back to that scope meanwhile, an entry may have hydrated the
   * pre-patch row before the patch landed: apply the same change to what is
   * loaded now, in memory only — storage already holds it.
   */
  const reconcileLoaded = <TItem>(
    scope: string,
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ) => {
    if (resource.scope.get() !== scope || getSlot().scope !== scope) return;
    for (const key of entityKeys(id)) {
      const current = port.read(key);
      if (current === undefined) continue;
      // A hydrate during the patch may have recorded the pre-patch row as stored.
      forgetStored(scope, [storageKey(key, getSlot().entries[key]?.query).queryKey]);
      if (mapEntity(current, id, fn) === undefined) remove(key);
      else
        update(key, (data) => (data === undefined ? data : (mapEntity(data, id, fn) ?? data)), {
          persist: false,
        });
    }
  };

  /**
   * Confirmed patch of one entity everywhere it is loaded and in the persisted
   * rows of unloaded entries. `scope` targets a scope captured earlier (a
   * write confirmed after the account switched): when it is no longer active,
   * only that scope's persisted rows are patched and the view on screen —
   * another identity's — is left alone.
   */
  const updateEntity = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    options?: { persist?: boolean; scope?: string },
  ) => {
    if (options?.scope !== undefined && options.scope !== resource.scope.get()) {
      const scope = options.scope;
      if (options.persist === false) return;
      const settle = () => reconcileLoaded(scope, id, fn);
      void patchStoredEntityRows(id, fn, scope).then(settle, settle);
      return;
    }
    void applyEntity(id, fn, options);
  };

  /**
   * Confirmed removal of one entity everywhere (see `updateEntity`, including
   * its captured `scope`). Unlike a plain mapper returning `undefined`, it is
   * also remembered for that scope:
   * a value hydrated afterwards — even by a read already in flight — comes
   * back without the entity (see `removedEntities`).
   */
  const removeEntity = (id: string, options?: { persist?: boolean; scope?: string }) => {
    const scope = options?.scope ?? resource.scope.get();
    // A removal confirmed after the account switched belongs to the scope that
    // asked for it: guard and patch that scope's rows, never the active view.
    const offScope = scope !== resource.scope.get();
    const guard: { releasedAt?: number } = {};
    const guards = removedEntities.get(scope) ?? new Map<string, { releasedAt?: number }>();
    removedEntities.set(scope, guards);
    guards.set(id, guard);
    const release = () => {
      // A newer removal of the same id owns the slot now.
      if (guards.get(id) !== guard) return;
      guard.releasedAt = ++guardClock;
      pruneEntityGuards(scope);
    };
    // A scope left behind has nothing on screen: only its persisted rows drop
    // the entity, and the guard keeps a later hydrate there from reading it back.
    const patch = offScope
      ? options?.persist === false
        ? undefined
        : patchStoredEntityRows(id, () => undefined, scope).then((patched) => {
            // Switched back meanwhile: drop it from anything hydrated since.
            reconcileLoaded(scope, id, () => undefined);
            return patched;
          })
      : applyEntity(id, () => undefined, options);
    // Without a storage patch (`persist: false`) only reads already in flight
    // can hold the entity; with one, reads that start before it lands can too.
    // A patch that did not land (untrusted scope, unreadable index or row, a
    // failed write, an identity switch) leaves the entity in an unloaded row:
    // every later hydrate of that row could resurrect it, so the guard is kept
    // — until a server value holds the entity again, or a later removal of the
    // same id lands its patch.
    if (patch)
      void patch.then(
        (patched) => {
          if (patched) release();
        },
        () => undefined,
      );
    else release();
  };

  const beginEntityOptimistic = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): ReplicaOptimisticToken<TData>[] =>
    entityKeys(id).flatMap((key) => {
      // Removing a whole value (a detail) is applied on commit, not optimistically.
      if (!paging) {
        const current = port.read(key);
        if (current !== undefined && mapEntity(current, id, fn) === undefined) return [];
      }
      return [beginOptimistic(key, (data) => mapEntity(data, id, fn) ?? data)];
    });

  return {
    applyHead,
    beginEntityOptimistic,
    beginOptimistic,
    clear,
    clearGeneration,
    clearScope,
    removalGeneration,
    collapse,
    dispatch,
    ensureScope,
    entityKeys,
    fetcher,
    getConfirmed,
    hydrate,
    insertHead,
    isMissingHead,
    loadMore,
    optimistic,
    patchStoredEntity,
    patchStoredRows,
    persist,
    remove,
    removeEntity,
    replace,
    resource,
    retain,
    revalidate,
    update,
    updateEntity,
    updateMany,
  };
};

export type ReplicaEngine<TParams, TData, TFetched = TData> = ReturnType<
  typeof createReplicaEngine<TParams, TData, TFetched>
>;
