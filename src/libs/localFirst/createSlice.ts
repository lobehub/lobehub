import isEqual from 'fast-deep-equal';
import { useLayoutEffect } from 'react';
import type { SWRConfiguration } from 'swr';

import { QueryProjectionWriteQueue } from '@/libs/queryProjectionStorage';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { isLocalFirstSyncKey, localFirstKeys } from '@/libs/swr/keys';

import { localFirstStorageKey, stableQueryKey } from './defineResource';
import {
  applyHeadPage,
  applyNextPage,
  collapseToHead,
  getNextPageCursor,
  hasPagedItem,
  insertHeadItems,
  type LocalFirstPagedData,
  type LocalFirstPageResult,
  type LocalFirstPagingContext,
  mapPagedItem,
  toPersistedPage,
} from './paging';
import type { LocalFirstAction, LocalFirstEffect, LocalFirstViewWrite } from './reducer';
import { localFirstReducer } from './reducer';
import type { LocalFirstResource, LocalFirstState } from './types';

/** Reserved storage key of the per-scope index of persisted rows. */
export const LOCAL_FIRST_INDEX_KEY = '__localFirst:index';

type Setter<TStore> = (partial: Partial<TStore>, replace?: false, action?: any) => void;

/**
 * Where the materialized value lives in the domain store. Selectors keep
 * reading this location; the binding is the only writer.
 */
export interface LocalFirstLens<TStore, TData> {
  clear: (state: TStore) => Partial<TStore>;
  get: (state: TStore, key: string) => TData | undefined;
  /** Enumerate loaded keys (needed for entity propagation). */
  keys?: (state: TStore) => string[];
  set: (state: TStore, key: string, data: TData | undefined) => Partial<TStore>;
}

/**
 * How an entity (e.g. one topic) appears inside this resource's value. Paged
 * resources get it for free from `paging.getId`; a single-entity resource
 * (a detail cache) passes `getId`.
 */
export interface LocalFirstEntityAdapter<TData, TItem> {
  /** Map the entity value into the resource value; defaults to identity. */
  apply?: (data: TData, item: TItem) => TData;
  getId: (data: TData) => string;
}

export interface CreateLocalFirstSliceOptions<TStore, TParams, TData, TFetched> {
  /** Devtools action-name prefix. Defaults to the resource name. */
  actionPrefix?: string;
  /** Single-entity resources only: how to find / patch the entity. */
  entity?: LocalFirstEntityAdapter<TData, any>;
  /** Overrides `resource.fetcher` when the fetch needs store context. */
  fetcher?: (params: TParams, cursor?: any) => Promise<TFetched>;
  get: () => TStore;
  /** Paged: rows that only exist client-side (kept across refreshes, never persisted). */
  isClientOnly?: (item: any) => boolean;
  /** Reject a persisted value that cannot serve these params. Rarely needed: rows are stored per query. */
  isHydratable?: (cached: TData, params: TParams) => boolean;
  /**
   * Non-paged: fold a server response into the confirmed value. Return
   * `undefined` to keep the current value. Defaults to "the response is the value".
   */
  merge?: (incoming: TFetched, confirmed: TData | undefined, params: TParams) => TData | undefined;
  set: Setter<TStore>;
  /** Store field holding the {@link LocalFirstState} bookkeeping slot. */
  stateKey: keyof TStore & string;
  /** Strip transient / client-only parts before persisting; `undefined` skips. */
  toPersisted?: (data: TData) => TData | undefined;
  /** Where the view lives in the store; `recordLens(field)` covers `Record<key, TData>`. */
  view: LocalFirstLens<TStore, TData>;
  /** Paged: domain fields derived from params, written with every head page. */
  viewFields?: (params: TParams) => Partial<TData>;
}

export interface LocalFirstSyncOptions<TFetched> {
  enabled?: boolean;
  swr?: SWRConfiguration<TFetched>;
}

export interface LocalFirstSyncResult {
  error: unknown;
  /** The persisted projection has been read (or there is nothing to read). */
  isHydrated: boolean;
  /** A network request is in flight. Never a reason to hide store data. */
  isValidating: boolean;
  /** Re-run the network sync for this entry. */
  revalidate: () => Promise<unknown>;
}

export interface OptimisticMutationOptions<TData, TResult> {
  /** Turn the server result into the confirmed value; defaults to re-applying `apply`. */
  confirm?: (result: TResult) => (data: TData) => TData;
  /** Revalidate the entry after the server call settles. */
  revalidate?: boolean;
}

/** Handle of an optimistic overlay that is settled later (see `beginOptimistic`). */
export interface LocalFirstOptimisticToken<TData> {
  commit: (confirm?: (data: TData) => TData) => void;
  rollback: () => void;
}

/**
 * Bind a local-first resource to a domain Zustand store.
 *
 * The domain store stays the only UI source of truth: components read the
 * `view` location through their usual selectors. The binding owns the
 * transitions around it — hydrate-if-empty, server replace, pagination,
 * optimistic overlay with commit/rollback, scope isolation and serialized
 * persistence — and exposes a `useSync` hook that only orchestrates fetching.
 */
export const createLocalFirstSlice = <TStore, TParams, TData, TFetched = TData>(
  resource: LocalFirstResource<TParams, TData, TFetched>,
  options: CreateLocalFirstSliceOptions<TStore, TParams, TData, TFetched>,
) => {
  const { get, set, stateKey, view } = options;
  const paging = resource.paging;
  const pagingCtx: LocalFirstPagingContext<any> = { isClientOnly: options.isClientOnly };
  const prefix = options.actionPrefix ?? resource.name;
  const writeQueue = resource.storage
    ? new QueryProjectionWriteQueue<TData>(resource.storage)
    : undefined;
  const fetcher = options.fetcher ?? resource.fetcher;
  let mutationSeq = 0;
  /** Keys with a `loadMore` request in flight (the only valid `isLoadingMore`). */
  const loadingMore = new Set<string>();

  const getSlot = () => get()[stateKey] as unknown as LocalFirstState<TData>;
  const storageKey = (key: string, query?: string) => ({
    queryKey: localFirstStorageKey(key, query),
  });

  const toPersisted = (data: TData): TData | undefined => {
    const paged = paging ? (toPersistedPage(data as any, paging, pagingCtx) as TData) : data;
    return options.toPersisted ? options.toPersisted(paged) : paged;
  };

  // ---- persisted-row index ---------------------------------------------
  // Storage has no key listing, so each scope keeps an index row of the
  // storage keys this resource persisted. Entity changes use it to patch rows
  // whose entry is not loaded in memory (e.g. a status update for a list the
  // user navigated away from), so a later visit never hydrates a stale value.
  const indexKey = (scope: string) => ({ queryKey: LOCAL_FIRST_INDEX_KEY, scope });
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

  const runEffects = (effects: LocalFirstEffect<TData>[]) => {
    if (!writeQueue || effects.length === 0) return;
    // Until identity resolves the scope is a guess; never write into it.
    if (!resource.scope.canPersist()) return;
    for (const effect of effects) {
      const key = { ...storageKey(effect.key, effect.query), scope: effect.scope };
      if (effect.type === 'remove') {
        writeQueue.remove(key);
        trackStorageKey(effect.scope, key.queryKey, false);
        continue;
      }
      const data = toPersisted(effect.data);
      if (data === undefined) continue;
      writeQueue.set(key, { data, updatedAt: Date.now() });
      trackStorageKey(effect.scope, key.queryKey, true);
    }
  };

  const applyWrites = (state: TStore, writes: LocalFirstViewWrite<TData>[]) => {
    let patch: Partial<TStore> = {};
    let current = state;
    for (const write of writes) {
      const next = 'type' in write ? view.clear(current) : view.set(current, write.key, write.data);
      patch = { ...patch, ...next };
      current = { ...current, ...next };
    }
    return patch;
  };

  const dispatch = (action: LocalFirstAction<TData>): boolean => {
    const activeScope = resource.scope.get();
    // An action captured under another identity is stale — drop it.
    if (action.scope !== activeScope) return false;

    let state = get();
    let slot = getSlot();
    let patch: Partial<TStore> = {};
    if (slot.scope !== undefined && slot.scope !== activeScope) {
      const reset = localFirstReducer(slot, { scope: activeScope, type: 'resetScope' }, (key) =>
        view.get(state, key),
      );
      patch = applyWrites(state, reset.writes);
      state = { ...state, ...patch };
      slot = reset.state;
    }

    const transition = localFirstReducer(slot, action, (key) => view.get(state, key));
    if (transition.state === slot && transition.writes.length === 0 && slot === getSlot())
      return false;

    patch = { ...patch, ...applyWrites(state, transition.writes) };
    set(
      { ...patch, [stateKey]: transition.state } as Partial<TStore>,
      false,
      `${prefix}/${action.type}`,
    );
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
    return entry?.pending.length ? entry.base : view.get(get(), key);
  };

  const hydrate = async (params: TParams, scope = resource.scope.get()) => {
    if (!resource.storage) return false;
    const key = resource.key(params);
    const query = resource.query(params);
    const cached = await resource.storage.get({ ...storageKey(key, query), scope });
    if (!cached) return false;
    if (options.isHydratable && !options.isHydratable(cached.data, params)) return false;
    return dispatch({
      data: cached.data,
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
    const page = incoming as unknown as LocalFirstPageResult<unknown, unknown>;
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

  const replace = (params: TParams, incoming: TFetched, scope = resource.scope.get()) => {
    const key = resource.key(params);
    const query = resource.query(params);
    const entry = getSlot().entries[key];
    // A different query (filters, sort) must not merge with loaded pages. A
    // view seeded without bookkeeping is compared by its `viewFields`.
    const reset = entry
      ? entry.query !== query
      : paging !== undefined && !viewMatchesFields(view.get(get(), key), params);
    return dispatch({
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
  };

  /** Confirmed local write: patches the view (and the base under any overlay). */
  const update = (
    key: string,
    apply: (data: TData | undefined) => TData | undefined,
    { persist = true }: { persist?: boolean } = {},
  ) => dispatch({ apply, key, persist, scope: resource.scope.get(), type: 'update' });

  const remove = (key: string) => dispatch({ key, scope: resource.scope.get(), type: 'remove' });

  const revalidate = (key?: string) =>
    mutate((swrKey) =>
      isLocalFirstSyncKey(swrKey, resource.name, { key, scope: resource.scope.get() }),
    );

  /** Start an optimistic overlay now and settle it later (multi-resource flows). */
  const beginOptimistic = (
    key: string,
    apply: (data: TData) => TData,
  ): LocalFirstOptimisticToken<TData> => {
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
    const current = view.get(get(), key) as LocalFirstPagedData<unknown, unknown> | undefined;
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
      const latest = view.get(get(), key) as LocalFirstPagedData<unknown, unknown> | undefined;
      return (
        resource.scope.get() === scope &&
        getSlot().entries[key]?.query === query &&
        latest?.currentPage === depth
      );
    };
    try {
      const page = (await fetcher(params, cursor)) as unknown as LocalFirstPageResult<
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
    const state = get();
    const keys = view.keys?.(state) ?? Object.keys(getSlot().entries);
    return keys.filter((key) => {
      const data = view.get(state, key);
      if (data === undefined) return false;
      if (paging) return hasPagedItem(data as any, id, paging);
      return options.entity ? options.entity.getId(data) === id : false;
    });
  };

  /** Map one entity inside a value; `undefined` from `fn` removes it (paged only). */
  const mapEntity = <TItem>(
    data: TData,
    id: string,
    fn: (item: TItem) => TItem | undefined,
  ): TData | undefined => {
    if (paging) return mapPagedItem(data as any, id, fn as any, paging) as TData;
    const entity = options.entity;
    if (!entity || entity.getId(data) !== id) return data;
    const next = fn(data as unknown as TItem);
    if (next === undefined) return undefined;
    return entity.apply ? entity.apply(data, next) : (next as unknown as TData);
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
    if (persist) void patchStoredEntity(id, fn);
    for (const key of entityKeys(id)) {
      const current = view.get(get(), key);
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
  ): LocalFirstOptimisticToken<TData>[] =>
    entityKeys(id).flatMap((key) => {
      // Removing a single-entity value is applied on commit, not optimistically.
      if (!paging) {
        const current = view.get(get(), key);
        if (current !== undefined && mapEntity(current, id, fn) === undefined) return [];
      }
      return [beginOptimistic(key, (data) => mapEntity(data, id, fn) ?? data)];
    });

  // ---- fetch orchestration ----------------------------------------------

  /**
   * Fetch orchestration only: hydrates the persisted projection once per
   * scope/key/query, then lets SWR fetch and revalidate the head. Data never
   * flows through the return value — read it from the store.
   */
  const useSync = (
    params: TParams | null | undefined,
    { enabled = true, swr }: LocalFirstSyncOptions<TFetched> = {},
  ): LocalFirstSyncResult => {
    const scope = resource.scope.use();
    const key = params ? resource.key(params) : undefined;
    const active = enabled && !!params && key !== undefined;

    // Layout effect: runs before paint, so a scope switch never shows a frame
    // of the previous identity's data.
    useLayoutEffect(() => {
      if (active) ensureScope(scope);
    }, [active, scope]);

    const hydration = useClientDataSWR<boolean>(
      active && resource.persisted
        ? localFirstKeys.hydrate(
            resource.name,
            resource.version,
            scope,
            resource.storageKey(params!),
          )
        : null,
      async () => {
        await hydrate(params!, scope);
        return true;
      },
      { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false },
    );

    const sync = useClientDataSWR<TFetched>(
      active && fetcher
        ? localFirstKeys.sync(resource.name, resource.version, scope, key!, params)
        : null,
      () => fetcher!(params!, undefined),
      {
        ...swr,
        onSuccess: (data: TFetched, swrKey: string, config: any) => {
          replace(params!, data, scope);
          swr?.onSuccess?.(data, swrKey, config);
        },
      },
    );

    return {
      error: sync.error,
      isHydrated: !resource.persisted || hydration.data === true,
      isValidating: sync.isValidating,
      revalidate: () => sync.mutate(),
    };
  };

  return {
    beginEntityOptimistic,
    patchStoredEntity,
    beginOptimistic,
    collapse,
    dispatch,
    ensureScope,
    entityKeys,
    getConfirmed,
    hydrate,
    insertHead,
    loadMore,
    optimistic,
    remove,
    replace,
    resource,
    revalidate,
    update,
    updateEntity,
    useSync,
  };
};

export type LocalFirstSlice<TStore, TParams, TData, TFetched = TData> = ReturnType<
  typeof createLocalFirstSlice<TStore, TParams, TData, TFetched>
>;

/** Lens for the common case: a `Record<key, TData>` field on the store. */
export const recordLens = <TStore, TData>(
  field: keyof TStore & string,
): LocalFirstLens<TStore, TData> => ({
  clear: () => ({ [field]: {} }) as Partial<TStore>,
  get: (state, key) => (state[field] as Record<string, TData> | undefined)?.[key],
  keys: (state) => Object.keys((state[field] as Record<string, TData> | undefined) ?? {}),
  set: (state, key, data) => {
    const next = { ...(state[field] as Record<string, TData> | undefined) };
    if (data === undefined) delete next[key];
    else next[key] = data;
    return { [field]: next } as Partial<TStore>;
  },
});
