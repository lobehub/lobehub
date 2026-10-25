import isEqual from 'fast-deep-equal';

import { replicaStorageKey, stableQueryKey } from './defineReplica';
import { createEntityPropagation } from './entityPropagation';
import {
  applyHeadPage,
  applyNextPage,
  collapseToHead,
  getNextPageCursor,
  insertHeadItems,
  joinPages,
  pagingFor,
  type ReplicaPagedData,
  type ReplicaPageResult,
  type ReplicaPagingContext,
  toPersistedPage,
} from './paging';
import { createPersistedRows } from './persistedRows';
import type { ReplicaAction, ReplicaEffect, ReplicaViewWrite } from './reducer';
import { replicaReducer } from './reducer';
import { createEntityRemovalGuards, createRemovalGuards } from './removalGuards';
import type { ReplicaResource, ReplicaSource, ReplicaState } from './types';
import { ReplicaWriteQueue } from './writeQueue';

/** Reserved storage key of the per-scope index of persisted rows. */
export { REPLICA_INDEX_KEY } from './persistedRows';

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
  const at = (key: string) => pagingFor(paging!, key);
  const pagingCtx: ReplicaPagingContext<any> = { isClientOnly: options.isClientOnly };
  const prefix = options.actionPrefix ?? resource.name;
  const writeQueue = resource.storage ? new ReplicaWriteQueue<TData>(resource.storage) : undefined;
  const fetcher = options.fetcher ?? resource.fetcher;
  let mutationSeq = 0;
  /** Keys with a `loadMore` request in flight (the only valid `isLoadingMore`). */
  const loadingMore = new Set<string>();

  // ---- removal guards (see `removalGuards.ts`) -----------------------------
  const { clearRemoved, isPurged, isRemoved, markPurged, markRemoved, removalGeneration } =
    createRemovalGuards();
  const entityGuards = createEntityRemovalGuards();

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

  // ---- persisted rows (see `persistedRows.ts`) -----------------------------
  const rows = createPersistedRows<TData>({
    commit: (keys, state) =>
      port.commit(
        keys.map((key) => ({ data: undefined, key })),
        state,
        `${prefix}/evict`,
      ),
    getSlot,
    isRemoved,
    loadingMore,
    resource,
    writeQueue,
  });
  const { deleteRows, readIndex, removeStoredVariants, retain, touchStorageKey } = rows;

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
      rows.writeRow(effect.scope, key.queryKey, data);
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
      rows.forgetScope(slot.scope);
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
  const keepClientOnlyRows = (incoming: TData, current: TData | undefined, key: string): TData => {
    if (!paging || !options.isClientOnly || !current) return incoming;
    const page = incoming as unknown as ReplicaPagedData<unknown, unknown>;
    const currentItems = (current as unknown as ReplicaPagedData<unknown, unknown>).items ?? [];
    const incomingIds = new Set(page.items.map((item) => paging.getId(item)));
    const survivors = currentItems.filter(
      (item) => options.isClientOnly!(item) && !incomingIds.has(paging.getId(item)),
    );
    if (survivors.length === 0) return incoming;
    const items = joinPages(survivors, page.items, at(key).direction);
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
    const settle = entityGuards.startHydrate(scope);
    try {
      return await readAndHydrate(params, key, scope, overwrite);
    } finally {
      settle();
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
    const writesBefore = rows.writeCount();
    const cached = await storage.get({ queryKey, scope });
    if (!cached) return false;
    // Re-check after the read: a removal or a clear that landed while it was in
    // flight must not resurrect the row it just dropped.
    if (isRemoved(scope, key) || clearGeneration(scope) !== generation) return false;
    // The row holds what was read, unless a write was queued while reading.
    rows.rememberRead(scope, queryKey, cached.data, writesBefore);
    if (options.isHydratable && !options.isHydratable(cached.data, params)) return false;
    // Entities deleted while the read was in flight may still be in the row.
    const stored = withoutRemovedEntities(scope, cached.data);
    if (stored === undefined) return false;
    const data = overwrite ? keepClientOnlyRows(stored, port.read(key), key) : stored;
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
      ...applyHeadPage(confirmed as any, page, { pageSize, reset }, at(key), pagingCtx),
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
    rows.forgetScope(scope);
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
    const queued = deleteRows(scope, [...(rows.indexedKeys(scope) ?? [])]);
    let persisted: string[];
    try {
      persisted = await readIndex(scope);
    } catch {
      return false;
    }
    // Keys this session tracks are already queued above, or were written by a
    // newer response since the clear (their row is fresh): skip both.
    const known = rows.indexedKeys(scope);
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
    const cursor = getNextPageCursor(current, at(key));
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
        (data) => data && (applyNextPage(data as any, page, at(key), pagingCtx) as TData),
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
      ? update(key, (data) => data && (insertHeadItems(data as any, items, at(key)) as TData), {
          persist,
        })
      : false;

  /** Drop loaded pages, keeping the head (e.g. after an edit inside older pages). */
  const collapse = (key: string) =>
    paging
      ? update(key, (data) => data && (collapseToHead(data as any, at(key)) as TData), {
          persist: false,
        })
      : false;

  // ---- entity propagation (see `entityPropagation.ts`) ---------------------
  const entities = createEntityPropagation<TData>({
    beginOptimistic,
    entity: options.entity,
    entityGuards,
    getSlot,
    paging,
    port,
    remove,
    resource,
    rows,
    update,
  });
  const {
    beginEntityOptimistic,
    entityKeys,
    forgetRestoredEntities,
    patchStoredEntity,
    removeEntity,
    updateEntity,
    withoutRemovedEntities,
  } = entities;
  const { patchStoredRows } = rows;

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
