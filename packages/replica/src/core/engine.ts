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
import { createTombstones } from './tombstones';
import type { ReplicaResource, ReplicaState } from './types';
import { ReplicaWriteQueue } from './writeQueue';

/** Reserved storage key of the per-scope index of persisted rows. */
export const REPLICA_INDEX_KEY = '__replica:index';

/**
 * How many removed entity ids one engine remembers per run. They only close the
 * race with a hydrate that was already reading when the entity was deleted, so
 * a small window is enough and keeps a long-lived session bounded.
 */
export const REMOVED_ENTITY_LIMIT = 500;

/**
 * Whether an entity mapper is a removal: it ignores the item and always answers
 * `undefined` (`() => undefined`, what `linkReplicaEntity.remove` passes).
 */
const isEntityRemoval = (fn: (item: any) => unknown): boolean => {
  if (fn.length !== 0) return false;
  try {
    return (fn as () => unknown)() === undefined;
  } catch {
    return false;
  }
};

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
  const markRemoved = (scope: string, key: string) => removedEntries.add(scope, key);
  const clearRemoved = (scope: string, key: string) => {
    removedEntries.clear(scope, key);
    purgedEntries.clear(scope, key);
  };
  const isRemoved = (scope: string, key: string) => removedEntries.has(scope, key);
  const markPurged = (scope: string, key: string) => purgedEntries.add(scope, key);
  const isPurged = (scope: string, key: string) => purgedEntries.has(scope, key);

  /**
   * Entity ids removed per scope (see `updateEntity`). A hydrate that read its
   * row before the removal patched storage still holds the entity, so it is
   * stripped from every value that hydrates afterwards. An id is forgotten once
   * a server value holds the entity again, or when the bound evicts it.
   */
  const removedEntities = createTombstones(REMOVED_ENTITY_LIMIT);

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

  const trackStorageKey = (scope: string, queryKey: string, present: boolean) => {
    if (!writeQueue) return;
    const known = indexed.get(scope) ?? new Set<string>();
    indexed.set(scope, known);
    if (known.has(queryKey) === present) return;
    if (present) known.add(queryKey);
    else known.delete(queryKey);
    writeQueue.update(indexKey(scope), (current) => {
      const keys = new Set((current?.data as unknown as string[] | undefined) ?? []);
      if (keys.has(queryKey) === present) return undefined;
      if (present) keys.add(queryKey);
      else keys.delete(queryKey);
      return { data: [...keys] as unknown as TData, updatedAt: Date.now() };
    });
  };

  const readIndex = async (scope: string): Promise<string[]> => {
    const row = await resource.storage?.get(indexKey(scope));
    return (row?.data as unknown as string[] | undefined) ?? [];
  };

  /**
   * Drop storage keys from the index (both the session's view of it and the
   * persisted row, which may list keys this session never wrote). An emptied
   * index row is removed.
   */
  const untrackStorageKeys = (scope: string, queryKeys: string[]) => {
    if (!writeQueue || queryKeys.length === 0) return;
    const known = indexed.get(scope);
    for (const queryKey of queryKeys) known?.delete(queryKey);
    const dropped = new Set(queryKeys);
    writeQueue.update(indexKey(scope), (current) => {
      const keys = (current?.data as unknown as string[] | undefined) ?? [];
      const next = keys.filter((queryKey) => !dropped.has(queryKey));
      if (!current || next.length === keys.length) return undefined;
      if (next.length === 0) return null;
      return { data: next as unknown as TData, updatedAt: Date.now() };
    });
  };

  /**
   * Delete every persisted row of entry `key` in `scope` — `current` (the row
   * memory knows about, queued right away so it orders before any later write)
   * plus every other query variant the index lists. Resolves `true` once all
   * deletes landed.
   */
  const removeStoredVariants = (scope: string, key: string, current: string) => {
    const queue = writeQueue!;
    const first = queue.remove({ queryKey: current, scope });
    untrackStorageKeys(scope, [current]);
    const rest = readIndex(scope).then(
      async (persisted) => {
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
        if (variants.size === 0) return true;
        untrackStorageKeys(scope, [...variants]);
        const removed = await Promise.all(
          [...variants].map((queryKey) => queue.remove({ queryKey, scope })),
        );
        return removed.every(Boolean);
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
        writeQueue.remove(key);
        trackStorageKey(effect.scope, key.queryKey, false);
        continue;
      }
      writeQueue.set(key, { data, updatedAt: Date.now() });
      trackStorageKey(effect.scope, key.queryKey, true);
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

  const dispatch = (action: ReplicaAction<TData>): boolean => {
    const activeScope = resource.scope.get();
    // An action captured under another identity is stale — drop it.
    if (action.scope !== activeScope) return false;

    // Every removal path (explicit `remove`, a missing response, an entity that
    // takes its whole value with it) arms the hydration guard for this key.
    if (action.type === 'remove') markRemoved(action.scope, action.key);
    // A replacement that reaches the active scope supersedes an earlier removal,
    // so the key may hydrate again. A response captured under another scope is
    // dropped below and must NOT clear its guard: the removal still stands for
    // its own scope, whose row delete may be pending or may have failed.
    if (action.type === 'replace') clearRemoved(action.scope, action.key);

    const initial = getSlot();
    let slot = initial;
    const writes: ReplicaViewWrite<TData>[] = [];
    const read = (key: string) => readThrough(writes, key);
    if (slot.scope !== undefined && slot.scope !== activeScope) {
      const reset = replicaReducer(slot, { scope: activeScope, type: 'resetScope' }, read);
      writes.push(...reset.writes);
      slot = reset.state;
    }

    const transition = replicaReducer(slot, action, read);
    if (transition.state === slot && transition.writes.length === 0 && slot === initial)
      return false;

    writes.push(...transition.writes);
    port.commit(writes, transition.state, `${prefix}/${action.type}`);
    runEffects(transition.effects);
    return true;
  };

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

  const hydrate = async (params: TParams, scope = resource.scope.get()) => {
    if (!resource.storage) return false;
    // An identity-less runtime reads network-only: its scope is a guess, so
    // hydrating it could paint another session's private rows.
    if (resource.scope.canHydrate && !resource.scope.canHydrate()) return false;
    const key = resource.key(params);
    if (!resource.persistKey(key)) return false;
    // A removed entry is not read back: only a later server value supersedes
    // the removal (see `replace`), so a stale row can never repaint it.
    if (isRemoved(scope, key)) return false;
    // A read started before a `clear()` of this scope holds a wiped row.
    const generation = clearGeneration(scope);
    // After a `clear()`, read only once its row deletes landed.
    const purge = scopePurges.get(scope);
    if (purge && !(await purge)) return false;
    const query = resource.query(params);
    const cached = await resource.storage.get({ ...storageKey(key, query), scope });
    if (!cached) return false;
    // Re-check after the read: a removal or a clear that landed while it was in
    // flight must not resurrect the row it just dropped.
    if (isRemoved(scope, key) || clearGeneration(scope) !== generation) return false;
    if (options.isHydratable && !options.isHydratable(cached.data, params)) return false;
    // Entities deleted while the read was in flight may still be in the row.
    const data = withoutRemovedEntities(scope, cached.data);
    if (data === undefined) return false;
    return dispatch({
      data,
      key,
      params,
      query,
      scope,
      type: 'hydrate',
      updatedAt: cached.updatedAt,
    });
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

  const replace = (params: TParams, fetched: TFetched, scope = resource.scope.get()) => {
    const key = resource.key(params);
    const incoming = options.prepareHead
      ? options.prepareHead(fetched, port.read(key), params)
      : fetched;
    if (incoming === undefined) return false;
    // A response that says the entry is gone clears it outright: the merge path
    // would keep — and re-persist — the confirmed value it is replacing. It also
    // arms the hydration guard, so a persisted read still in flight cannot bring
    // the dropped value back.
    if (!paging && options.isMissing?.(incoming)) {
      // Route through `remove` so a repeated "missing" is a no-op and a response
      // captured under another scope is dropped rather than applied here.
      return remove(key, scope);
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
    return applied;
  };

  /** Confirmed local write: patches the view (and the base under any overlay). */
  const update = (
    key: string,
    apply: (data: TData | undefined) => TData | undefined,
    { persist = true }: { persist?: boolean } = {},
  ) => dispatch({ apply, key, persist, scope: resource.scope.get(), type: 'update' });

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
    const known = [...(indexed.get(scope) ?? [])];
    indexed.delete(scope);
    const queued = known.map((queryKey) => writeQueue.remove({ queryKey, scope }));
    untrackStorageKeys(scope, known);
    let persisted: string[];
    try {
      persisted = await readIndex(scope);
    } catch {
      return false;
    }
    // A key tracked again since the clear was written by a newer response: its
    // row is fresh, keep it.
    const fresh = indexed.get(scope);
    const queuedKeys = new Set(known);
    const stale = persisted.filter(
      (queryKey) => !queuedKeys.has(queryKey) && !fresh?.has(queryKey),
    );
    untrackStorageKeys(scope, stale);
    const removed = await Promise.all([
      ...queued,
      ...stale.map((queryKey) => writeQueue.remove({ queryKey, scope })),
    ]);
    return removed.every(Boolean);
  };

  const revalidate = (key?: string): Promise<unknown> =>
    options.revalidate ? options.revalidate(key) : Promise.resolve();

  /** Start an optimistic overlay now and settle it later (multi-resource flows). */
  const beginOptimistic = (
    key: string,
    apply: (data: TData) => TData,
  ): ReplicaOptimisticToken<TData> => {
    const scope = resource.scope.get();
    const id = ++mutationSeq;
    dispatch({ apply, id, key, scope, type: 'optimistic' });
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
    const removed = removedEntities.list(scope);
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
    const removed = removedEntities.list(scope);
    if (removed.length === 0 || data === undefined) return;
    for (const id of heldEntities(data, removed)) removedEntities.clear(scope, id);
  };

  /**
   * Apply an entity change to persisted rows that memory does not hold (the
   * memory path already persists loaded entries). Read-modify-write runs in
   * the per-key write queue, so it sees every earlier write; a missing row is
   * never recreated. Resolves once the index has been read and the patches
   * are queued.
   */
  const patchStoredEntity = async <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): Promise<void> => {
    if (!writeQueue || !resource.scope.canPersist()) return;
    const scope = resource.scope.get();
    const slot = getSlot();
    const loaded = new Set(
      slot.scope === scope
        ? Object.entries(slot.entries).map(([key, entry]) => storageKey(key, entry.query).queryKey)
        : [],
    );
    const keys = await readIndex(scope);
    // Identity changed while reading the index: those rows are not ours to touch.
    if (resource.scope.get() !== scope) return;
    for (const queryKey of keys) {
      if (loaded.has(queryKey)) continue;
      writeQueue.update({ queryKey, scope }, (current) => {
        if (!current) return undefined;
        const next = mapEntity(current.data, id, fn);
        if (next === current.data) return undefined;
        if (next === undefined) {
          trackStorageKey(scope, queryKey, false);
          return null;
        }
        return { data: next, updatedAt: Date.now() };
      });
    }
  };

  const updateEntity = <TItem>(
    id: string,
    fn: (item: TItem) => TItem | undefined,
    { persist = true }: { persist?: boolean } = {},
  ) => {
    // A removal also applies to values hydrated later (see `removedEntities`):
    // a hydrate of an unloaded entry may have read its row before the patch.
    if (isEntityRemoval(fn)) removedEntities.add(resource.scope.get(), id);
    if (persist) void patchStoredEntity(id, fn);
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
    beginEntityOptimistic,
    beginOptimistic,
    clear,
    clearGeneration,
    collapse,
    dispatch,
    ensureScope,
    entityKeys,
    fetcher,
    getConfirmed,
    hydrate,
    insertHead,
    loadMore,
    optimistic,
    patchStoredEntity,
    persist,
    remove,
    replace,
    resource,
    revalidate,
    update,
    updateEntity,
  };
};

export type ReplicaEngine<TParams, TData, TFetched = TData> = ReturnType<
  typeof createReplicaEngine<TParams, TData, TFetched>
>;
