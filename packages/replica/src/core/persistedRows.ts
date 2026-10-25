import isEqual from 'fast-deep-equal';

import { isReplicaStorageKeyOf, replicaStorageKey } from './defineReplica';
import type { ReplicaResource, ReplicaState } from './types';
import { readReplicaRowStrict, type ReplicaWriteQueue } from './writeQueue';

/** Reserved storage key of the per-scope index of persisted rows. */
export const REPLICA_INDEX_KEY = '__replica:index';

export interface ReplicaPersistedRowsDeps<TData> {
  /** Drop evicted entries from the host view (one commit). */
  commit: (keys: string[], state: ReplicaState<TData>) => void;
  getSlot: () => ReplicaState<TData>;
  /** Whether `scope`/`key` is guarded as removed (see `createRemovalGuards`). */
  isRemoved: (scope: string, key: string) => boolean;
  /** Keys with a `loadMore` request in flight (pinned against eviction). */
  loadingMore: ReadonlySet<string>;
  resource: ReplicaResource<any, TData, any>;
  writeQueue: ReplicaWriteQueue<TData> | undefined;
}

/** Returned by a `patchRow` transform to delete the row (`null` stays a value). */
export const DROP_ROW = Symbol('replica.dropRow');

/**
 * Bookkeeping of the rows one engine persisted: the per-scope index, the latest
 * queued write per row, what each row is known to hold, and the bounded
 * (`persist.maxEntries`) eviction. Every row write and delete of the engine
 * goes through here, so the index never misses or resurrects a row.
 */
export const createPersistedRows = <TData>({
  commit,
  getSlot,
  isRemoved,
  loadingMore,
  resource,
  writeQueue,
}: ReplicaPersistedRowsDeps<TData>) => {
  // ---- persisted-row index ---------------------------------------------
  // Storage has no key listing, so each scope keeps an index row of the
  // storage keys this resource persisted. Entity changes use it to patch rows
  // whose entry is not loaded in memory (e.g. a status update for a list the
  // user navigated away from), so a later visit never hydrates a stale value.
  const indexKey = (scope: string) => ({ queryKey: REPLICA_INDEX_KEY, scope });
  /** Keys known to be in the index row, per scope (skips redundant index writes). */
  const indexed = new Map<string, Set<string>>();
  const indexedKeys = (scope: string) => indexed.get(scope);

  /**
   * Latest queued write per row (`scope` + storage key), from one monotonic
   * counter. A confirmed delete only takes its key out of the index when no
   * later write re-created the row in the meantime.
   */
  const rowWrites = new Map<string, number>();
  let writeCounter = 0;
  const writeCount = () => writeCounter;
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
  /** Forget every row of `scope` (memory moved to another identity, or a clear). */
  const forgetScope = (scope: string) => {
    storedValues.delete(scope);
  };
  const isStored = (scope: string, queryKey: string, data: unknown) => {
    const rows = storedValues.get(scope);
    return !!rows?.has(queryKey) && isEqual(rows.get(queryKey), data);
  };
  /**
   * A hydrate read `data` back from the row: the row holds it, unless a write
   * was queued while reading (`writesBefore` is `writeCount()` before the read).
   */
  const rememberRead = (scope: string, queryKey: string, data: unknown, writesBefore: number) => {
    if (writeCounter === writesBefore && !storedValues.get(scope)?.has(queryKey))
      rememberStored(scope, queryKey, data);
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
      commit(dropped, { entries, scope });
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

  /** Persist `data` to one row (the write path of a `persist` effect). */
  const writeRow = (scope: string, queryKey: string, data: TData) => {
    const queue = writeQueue!;
    // The row already holds this value: an unchanged revalidation is no write.
    if (isStored(scope, queryKey, data)) {
      touchStorageKey(scope, queryKey);
      return;
    }
    // Until this write is confirmed the row's content is unknown: forget what
    // it held, and only remember `data` once the write observably landed and
    // is still the latest queued for the row. A failed (or best-effort,
    // silently dropped) write therefore never makes a later identical persist
    // look redundant — that one writes again.
    forgetStored(scope, [queryKey]);
    trackStorageKey(scope, queryKey);
    const id = rowId(scope, queryKey);
    const seq = rowWrites.get(id);
    void queue.set({ queryKey, scope }, { data, updatedAt: Date.now() }).then((written) => {
      if (written && rowWrites.get(id) === seq) rememberStored(scope, queryKey, data);
    });
  };

  /**
   * Read-modify-write one row in the per-key write queue, so it sees every
   * earlier write; a missing row is never recreated. `transform` returns the
   * next data, `undefined` to leave the row, or `DROP_ROW` to drop it (the row
   * leaves the index once its delete landed). Resolves whether it settled.
   */
  const patchRow = (
    scope: string,
    queryKey: string,
    transform: (data: TData) => TData | typeof DROP_ROW | undefined,
  ): Promise<boolean> => {
    const seq = noteWrite(scope, queryKey);
    forgetStored(scope, [queryKey]);
    let dropped = false;
    return writeQueue!
      .update(
        { queryKey, scope },
        (current) => {
          if (!current) return undefined;
          const next = transform(current.data);
          if (next === undefined) return undefined;
          if (next === DROP_ROW) {
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
        ? Object.entries(slot.entries).map(([key, entry]) => replicaStorageKey(key, entry.query))
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
    const patches: Promise<boolean>[] = [];
    for (const queryKey of keys) {
      if (loaded.has(queryKey)) continue;
      patches.push(
        patchRow(scope, queryKey, (data) => {
          const next = fn(data);
          if (next === data) return undefined;
          return next === null ? DROP_ROW : next;
        }),
      );
    }
    await Promise.all(patches);
  };

  return {
    deleteRows,
    forgetScope,
    forgetStored,
    indexedKeys,
    patchRow,
    patchStoredRows,
    readIndex,
    rememberRead,
    removeStoredVariants,
    retain,
    touchStorageKey,
    writeCount,
    writeRow,
  };
};

export type ReplicaPersistedRows<TData> = ReturnType<typeof createPersistedRows<TData>>;
