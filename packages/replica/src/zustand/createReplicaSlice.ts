import { useLayoutEffect } from 'react';

import { createReplicaEngine, type ReplicaEngineOptions } from '../core/engine';
import { isReplicaSyncKey, replicaKeys } from '../core/keys';
import type { ReplicaPagedData } from '../core/paging';
import type { ReplicaViewWrite } from '../core/reducer';
import type { ReplicaResource, ReplicaState } from '../core/types';
import type { ReplicaSyncDriver, ReplicaSyncSchedule } from './driver';

/** Zustand `setState`, with the devtools action label. */
type Setter<TStore> = (partial: Partial<TStore>, replace?: false, action?: any) => void;

/**
 * Where the materialized value lives in the domain store. Selectors keep
 * reading this location; the slice is the only writer.
 */
export interface ReplicaLens<TStore, TData> {
  clear: (state: TStore) => Partial<TStore>;
  get: (state: TStore, key: string) => TData | undefined;
  /** Enumerate loaded keys (needed for entity propagation). */
  keys?: (state: TStore) => string[];
  set: (state: TStore, key: string, data: TData | undefined) => Partial<TStore>;
}

export interface CreateReplicaSliceOptions<TStore, TParams, TData, TFetched> extends Omit<
  ReplicaEngineOptions<TParams, TData, TFetched>,
  'port' | 'revalidate'
> {
  /** Query cache that schedules fetches (see `createSWRDriver`). */
  driver: ReplicaSyncDriver;
  get: () => TStore;
  set: Setter<TStore>;
  /** Store field holding the {@link ReplicaState} bookkeeping slot. */
  stateKey: keyof TStore & string;
  /** Where the view lives in the store; `recordLens(field)` covers `Record<key, TData>`. */
  view: ReplicaLens<TStore, TData>;
}

export interface ReplicaSyncOptions<TFetched = unknown> extends ReplicaSyncSchedule {
  enabled?: boolean;
  /** Side effects of a failed fetch (error side-maps); the store view is left as is. */
  onError?: (error: unknown) => void;
  /**
   * Side effects of a response, run after it is folded into the replica
   * (e.g. adopting an active id, or settling a "not found" state).
   */
  onSuccess?: (data: TFetched) => void;
}

export interface ReplicaSyncResult {
  error: unknown;
  /** The persisted row has been read (or there is nothing to read). */
  isHydrated: boolean;
  /** A network request is in flight. Never a reason to hide store data. */
  isValidating: boolean;
  /** Re-run the network sync for this entry. */
  revalidate: () => Promise<unknown>;
}

/**
 * Bind a replica to a domain Zustand store.
 *
 * The domain store stays the only UI source of truth: components read the
 * `view` location through their usual selectors. The engine owns every
 * transition of that location; this slice adds the Zustand port and a
 * `useSync` hook that only orchestrates fetching — data never flows through
 * its return value.
 */
export const createReplicaSlice = <TStore, TParams, TData, TFetched = TData>(
  resource: ReplicaResource<TParams, TData, TFetched>,
  {
    driver,
    get,
    set,
    stateKey,
    view,
    ...options
  }: CreateReplicaSliceOptions<TStore, TParams, TData, TFetched>,
) => {
  const applyWrites = (state: TStore, writes: ReplicaViewWrite<TData>[]) => {
    let patch: Partial<TStore> = {};
    let current = state;
    for (const write of writes) {
      const next = 'type' in write ? view.clear(current) : view.set(current, write.key, write.data);
      patch = { ...patch, ...next };
      current = { ...current, ...next };
    }
    return patch;
  };

  const revalidate = (key?: string) =>
    driver.revalidate((queryKey) =>
      isReplicaSyncKey(queryKey, resource.name, { key, scope: resource.scope.get() }),
    );

  const engine = createReplicaEngine(resource, {
    ...options,
    port: {
      commit: (writes, state, label) =>
        set({ ...applyWrites(get(), writes), [stateKey]: state } as Partial<TStore>, false, label),
      getState: () => get()[stateKey] as unknown as ReplicaState<TData>,
      keys: view.keys && (() => view.keys!(get())),
      read: (key) => view.get(get(), key),
    },
    revalidate,
  });
  const { ensureScope, fetcher, hydrate, replace } = engine;

  /**
   * Row key of the head query each entry last asked for. One entry backs a
   * single view, so a response that belongs to a query the entry has already
   * moved past must not repaint it — it would show a superseded query, and a
   * view gated on the current query would then wait forever. Making this an
   * invariant of the slice (not of one driver) keeps it true for drivers that
   * leave a request's own callback live after the query changed.
   */
  const headQuery = new Map<string, string>();

  /**
   * Hydrates the persisted row once per scope/key/query, then lets the driver
   * fetch and revalidate the head. Read the data from the store.
   */
  const useSync = (
    params: TParams | null | undefined,
    { enabled = true, onError, onSuccess, ...schedule }: ReplicaSyncOptions<TFetched> = {},
  ): ReplicaSyncResult => {
    const scope = resource.scope.use();
    const key = params ? resource.key(params) : undefined;
    const active = enabled && !!params && key !== undefined;
    const queryKey = params ? resource.storageKey(params) : undefined;

    // Layout effect: runs before paint, so a scope switch never shows a frame
    // of the previous identity's data.
    useLayoutEffect(() => {
      if (active) ensureScope(scope);
    }, [active, scope]);

    // Remember the query this entry now asks for (see `headQuery`).
    useLayoutEffect(() => {
      if (active && key !== undefined && queryKey !== undefined) headQuery.set(key, queryKey);
    }, [active, key, queryKey]);

    const hydration = driver.useQuery<boolean>(
      active && resource.persisted && resource.persistKey(key!)
        ? replicaKeys.hydrate(resource.name, resource.version, scope, resource.storageKey(params!))
        : null,
      async () => {
        await hydrate(params!, scope);
        return true;
      },
      { once: true },
    );

    const sync = driver.useQuery<TFetched>(
      active && fetcher
        ? (resource.syncKey?.(params!) ??
            replicaKeys.sync(resource.name, resource.version, scope, key!, params))
        : null,
      () => fetcher!(params!, undefined),
      {
        ...schedule,
        onError,
        onSuccess: (data) => {
          // Discard a head response the entry has moved past: the newer query
          // owns the view (see `headQuery`).
          if (queryKey === undefined || headQuery.get(key!) !== queryKey) return;
          replace(params!, data, scope);
          onSuccess?.(data);
        },
      },
    );

    return {
      error: sync.error,
      isHydrated:
        !resource.persisted ||
        (key !== undefined && !resource.persistKey(key)) ||
        hydration.data === true,
      isValidating: sync.isValidating,
      revalidate: () => sync.mutate(),
    };
  };

  return {
    ...engine,
    /**
     * Forget the key's head query as well as the entry. A request already in
     * flight for it would otherwise pass the `onSuccess` guard below (the marker
     * still matches), `replace` the entry and persist pre-mutation rows back over
     * an invalidation that has already completed.
     */
    remove: (key: string) => {
      headQuery.delete(key);
      return engine.remove(key);
    },
    useSync,
  };
};

export type ReplicaSlice<TStore, TParams, TData, TFetched = TData> = ReturnType<
  typeof createReplicaSlice<TStore, TParams, TData, TFetched>
>;

/** Lens for the common case: a `Record<key, TData>` field on the store. */
export const recordLens = <TStore, TData>(
  field: keyof TStore & string,
): ReplicaLens<TStore, TData> => ({
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

/**
 * Lens for a paged view split across store fields: the rows stay where
 * existing readers expect them (`itemsField[key]`, a plain array), the paging
 * bookkeeping lives in `metaField[key]`, and `derive` recomputes fields built
 * from the rows (e.g. a parsed display list) in the same commit — so a derived
 * field is never one frame behind its rows.
 *
 * Rows seeded without bookkeeping (by code outside the replica) read as a
 * single head page.
 */
export const splitPagedLens = <TStore, TItem, TCursor = unknown>({
  clearDerived,
  derive,
  itemsField,
  metaField,
}: {
  /** Derived fields to reset on a scope change. */
  clearDerived?: () => Partial<TStore>;
  /** Fields computed from an entry's rows (`undefined` = the entry is gone). */
  derive?: (state: TStore, key: string, items: TItem[] | undefined) => Partial<TStore>;
  itemsField: keyof TStore & string;
  metaField: keyof TStore & string;
}): ReplicaLens<TStore, ReplicaPagedData<TItem, TCursor>> => {
  type Meta = Omit<ReplicaPagedData<TItem, TCursor>, 'items'>;
  const NO_META = {} as Meta;
  // Same rows + same bookkeeping → the same view object, so the engine's
  // reference checks see "unchanged".
  const views = new WeakMap<TItem[], WeakMap<Meta, ReplicaPagedData<TItem, TCursor>>>();
  const remember = (items: TItem[], meta: Meta, view: ReplicaPagedData<TItem, TCursor>) => {
    let byMeta = views.get(items);
    if (!byMeta) views.set(items, (byMeta = new WeakMap()));
    byMeta.set(meta, view);
    return view;
  };
  const rowsOf = (state: TStore) => (state[itemsField] ?? {}) as Record<string, TItem[]>;
  const metaOf = (state: TStore) => (state[metaField] ?? {}) as Record<string, Meta>;

  return {
    clear: () => ({ [itemsField]: {}, [metaField]: {}, ...clearDerived?.() }) as Partial<TStore>,
    get: (state, key) => {
      const items = rowsOf(state)[key];
      if (!items) return undefined;
      const meta = metaOf(state)[key] ?? NO_META;
      const cached = views.get(items)?.get(meta);
      if (cached) return cached;
      const view =
        meta === NO_META
          ? { currentPage: 0, hasMore: true, items, pageSize: items.length }
          : { ...meta, items };
      return remember(items, meta, view);
    },
    keys: (state) => Object.keys(rowsOf(state)),
    set: (state, key, data) => {
      const rows = { ...rowsOf(state) };
      const metas = { ...metaOf(state) };
      if (data === undefined) {
        delete rows[key];
        delete metas[key];
      } else {
        const { items, ...meta } = data;
        rows[key] = items;
        metas[key] = meta;
        remember(items, meta, data);
      }
      const next = { ...state, [itemsField]: rows, [metaField]: metas } as TStore;
      return {
        [itemsField]: rows,
        [metaField]: metas,
        ...derive?.(next, key, data?.items),
      } as Partial<TStore>;
    },
  };
};
