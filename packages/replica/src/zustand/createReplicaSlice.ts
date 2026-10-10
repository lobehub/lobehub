import { useLayoutEffect, useRef } from 'react';

import { createReplicaEngine, type ReplicaEngineOptions } from '../core/engine';
import { isReplicaSyncKey, replicaKeys } from '../core/keys';
import type { ReplicaPagedData } from '../core/paging';
import type { ReplicaViewWrite } from '../core/reducer';
import type { ReplicaResource, ReplicaState } from '../core/types';
import type { ReplicaSyncDriver, ReplicaSyncSchedule } from './driver';

/** Zustand `setState`, with the devtools action label. */
type Setter<TStore> = (partial: Partial<TStore>, replace?: false, action?: any) => void;

/**
 * One `key` write in a batched lens update (see {@link ReplicaLens.setMany}).
 */
export interface ReplicaViewSet<TData> {
  data: TData | undefined;
  key: string;
}

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
  /**
   * Apply several key writes in one pass — one clone of the backing field
   * instead of one per key. Optional: the slice falls back to repeated `set`
   * when a lens does not implement it.
   */
  setMany?: (state: TStore, entries: ReplicaViewSet<TData>[]) => Partial<TStore>;
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

/**
 * What a failed sync read was captured under. `scope` is the cache scope active
 * when the request was issued, which may differ from the scope active when the
 * callback runs (an identity / workspace switch in between).
 */
export interface ReplicaSyncErrorContext {
  /** The entry key the read was for; `undefined` for a disabled read. */
  key: string | undefined;
  /** The cache scope the read was captured under. */
  scope: string;
}

export interface ReplicaSyncOptions<
  TFetched = unknown,
  TData = unknown,
> extends ReplicaSyncSchedule {
  enabled?: boolean;
  /**
   * Side effects of a failed fetch (error side-maps); the store view is left as is.
   * Receives the captured {@link ReplicaSyncErrorContext} so a terminal removal
   * can target the scope the request belonged to rather than the one that is
   * active once the callback runs.
   */
  onError?: (error: unknown, context: ReplicaSyncErrorContext) => void;
  /**
   * Side effects of a hydrated persisted value, run after it is folded into the
   * replica. A cold start with no network (offline / slow) has no response for
   * `onSuccess` to run on, so the same "success" handling must also run off the
   * persisted value it paints.
   */
  onHydrated?: (data: TData) => void;
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
  /**
   * Apply every view write as ONE host update, so subscribers never observe a
   * view out of step with its bookkeeping. Consecutive key writes go through
   * the lens' `setMany` when it has one, so seeding N rows clones the backing
   * field once instead of N times.
   */
  const applyWrites = (state: TStore, writes: ReplicaViewWrite<TData>[]) => {
    let patch: Partial<TStore> = {};
    let current = state;
    let pending: ReplicaViewSet<TData>[] = [];

    const flush = () => {
      if (pending.length === 0) return;
      const entries = pending;
      pending = [];
      if (view.setMany && entries.length > 1) {
        const next = view.setMany(current, entries);
        patch = { ...patch, ...next };
        current = { ...current, ...next };
        return;
      }
      for (const entry of entries) {
        const next = view.set(current, entry.key, entry.data);
        patch = { ...patch, ...next };
        current = { ...current, ...next };
      }
    };

    for (const write of writes) {
      if ('type' in write) {
        flush();
        const next = view.clear(current);
        patch = { ...patch, ...next };
        current = { ...current, ...next };
      } else {
        pending.push({ data: write.data, key: write.key });
      }
    }
    flush();
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
    {
      enabled = true,
      onError,
      onHydrated,
      onSuccess,
      ...schedule
    }: ReplicaSyncOptions<TFetched, TData> = {},
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

    // The entry this hook currently asks for. A hydrate that resolves after the
    // hook moved to another key still fills its own cache entry (harmless), but
    // it must not replay `onHydrated`: those side effects act on the *current*
    // view, so they would re-adopt a superseded object (e.g. navigate g1 → g2
    // while g1's storage read is slow, then g1's hydrate resets the active group
    // back to g1's supervisor).
    const activeKey = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
      activeKey.current = active ? key : undefined;
    }, [active, key]);

    const hydration = driver.useQuery<boolean>(
      active && resource.persisted && resource.persistKey(key!)
        ? replicaKeys.hydrate(resource.name, resource.version, scope, resource.storageKey(params!))
        : null,
      async () => {
        const didHydrate = await hydrate(params!, scope);
        // A persisted row is a successful value with no network response: replay
        // the success side effects off it, so an offline / slow first paint still
        // adopts the roster and settles the flags the response path would.
        if (didHydrate) {
          const hydrated = view.get(get(), key!);
          if (hydrated !== undefined && activeKey.current === key) onHydrated?.(hydrated);
        }
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
        // Bind the captured key/scope to the error callback: a late terminal
        // removal must not land in a scope that became active after the request.
        onError: onError ? (error: unknown) => onError(error, { key, scope }) : undefined,
        onSuccess: (data) => {
          // Discard a head response the entry has moved past: the newer query
          // owns the view (see `headQuery`).
          if (queryKey === undefined || headQuery.get(key!) !== queryKey) return;
          // A response that resolves after the identity moved on is rejected by
          // `replace` (it is not written, and must not be persisted). Never
          // replay its success side effects either: they act on the CURRENT
          // stores, so they would adopt the previous identity's data.
          if (replace(params!, data, scope)) onSuccess?.(data);
        },
      },
    );

    return {
      error: sync.error,
      // A read with no key has nothing to hydrate, so it counts as hydrated: a
      // conditional consumer must not show "loading" for an absent id (the
      // former SWR disabled-key behaviour). A read that is disabled but *has* a
      // key still waits for its persisted row.
      isHydrated:
        key === undefined ||
        !resource.persisted ||
        !resource.persistKey(key) ||
        hydration.data === true,
      isValidating: sync.isValidating,
      revalidate: () => sync.mutate(),
    };
  };

  return { ...engine, useSync };
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
  setMany: (state, entries) => {
    // One clone of the record, then every key — a list refresh seeds N groups
    // in a single copy instead of N.
    const next = { ...(state[field] as Record<string, TData> | undefined) };
    for (const { key, data } of entries) {
      if (data === undefined) delete next[key];
      else next[key] = data;
    }
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
