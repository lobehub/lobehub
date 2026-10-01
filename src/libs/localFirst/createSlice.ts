import { useLayoutEffect } from 'react';
import type { SWRConfiguration } from 'swr';

import { QueryProjectionWriteQueue } from '@/libs/queryProjectionStorage';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { isLocalFirstSyncKey, localFirstKeys } from '@/libs/swr/keys';

import type { LocalFirstAction, LocalFirstEffect, LocalFirstViewWrite } from './reducer';
import { localFirstReducer } from './reducer';
import type { LocalFirstResource, LocalFirstState } from './types';

type Setter<TStore> = (partial: Partial<TStore>, replace?: false, action?: any) => void;

/**
 * Where the materialized value lives in the domain store. Selectors keep
 * reading this location; the binding is the only writer.
 */
export interface LocalFirstLens<TStore, TData> {
  clear: (state: TStore) => Partial<TStore>;
  get: (state: TStore, key: string) => TData | undefined;
  set: (state: TStore, key: string, data: TData | undefined) => Partial<TStore>;
}

export interface CreateLocalFirstSliceOptions<TStore, TParams, TData, TFetched> {
  /** Devtools action-name prefix. Defaults to the resource name. */
  actionPrefix?: string;
  /** Overrides `resource.fetcher` when the fetch needs store context. */
  fetcher?: (params: TParams) => Promise<TFetched>;
  get: () => TStore;
  /** Reject a persisted value that cannot serve these params (e.g. other filters). */
  isHydratable?: (cached: TData, params: TParams) => boolean;
  /**
   * Fold a server response into the confirmed value. Return `undefined` to
   * keep the current value (no-op). Defaults to "the response is the value".
   */
  merge?: (incoming: TFetched, confirmed: TData | undefined, params: TParams) => TData | undefined;
  set: Setter<TStore>;
  /** Store field holding the {@link LocalFirstState} bookkeeping slot. */
  stateKey: keyof TStore & string;
  /** Strip transient / client-only parts before persisting; `undefined` skips. */
  toPersisted?: (data: TData) => TData | undefined;
  /** Where the view lives in the store; `recordLens(field)` covers `Record<key, TData>`. */
  view: LocalFirstLens<TStore, TData>;
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

/**
 * Bind a local-first resource to a domain Zustand store.
 *
 * The domain store stays the only UI source of truth: components read the
 * `view` location through their usual selectors. The binding owns the
 * transitions around it — hydrate-if-empty, server replace, optimistic
 * overlay with commit/rollback, scope isolation and serialized persistence —
 * and exposes a `useSync` hook that only orchestrates fetching.
 */
export const createLocalFirstSlice = <TStore, TParams, TData, TFetched = TData>(
  resource: LocalFirstResource<TParams, TData, TFetched>,
  options: CreateLocalFirstSliceOptions<TStore, TParams, TData, TFetched>,
) => {
  const { get, set, stateKey, view } = options;
  const prefix = options.actionPrefix ?? resource.name;
  const writeQueue = resource.storage
    ? new QueryProjectionWriteQueue<TData>(resource.storage)
    : undefined;
  const fetcher = options.fetcher ?? resource.fetcher;
  let mutationSeq = 0;

  const getSlot = () => get()[stateKey] as unknown as LocalFirstState<TData>;

  const runEffects = (effects: LocalFirstEffect<TData>[]) => {
    if (!writeQueue || effects.length === 0) return;
    // Until identity resolves the scope is a guess; never write into it.
    if (!resource.scope.canPersist()) return;
    for (const effect of effects) {
      const key = { queryKey: effect.key, scope: effect.scope };
      if (effect.type === 'remove') {
        writeQueue.remove(key);
        continue;
      }
      const data = options.toPersisted ? options.toPersisted(effect.data) : effect.data;
      if (data !== undefined) writeQueue.set(key, { data, updatedAt: Date.now() });
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
    const cached = await resource.storage.get({ queryKey: key, scope });
    if (!cached) return false;
    if (options.isHydratable && !options.isHydratable(cached.data, params)) return false;
    return dispatch({
      data: cached.data,
      key,
      scope,
      type: 'hydrate',
      updatedAt: cached.updatedAt,
    });
  };

  const replace = (params: TParams, incoming: TFetched, scope = resource.scope.get()) =>
    dispatch({
      data: (confirmed) =>
        options.merge ? options.merge(incoming, confirmed, params) : (incoming as unknown as TData),
      key: resource.key(params),
      scope,
      type: 'replace',
    });

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
    const scope = resource.scope.get();
    const id = ++mutationSeq;
    dispatch({ apply, id, key, scope, type: 'optimistic' });
    try {
      const result = await serverCall();
      dispatch({ confirm: mutationOptions.confirm?.(result), id, key, scope, type: 'commit' });
      return result;
    } catch (error) {
      dispatch({ id, key, scope, type: 'rollback' });
      throw error;
    } finally {
      if (mutationOptions.revalidate) void revalidate(key);
    }
  };

  /**
   * Fetch orchestration only: hydrates the persisted projection once per
   * scope/key, then lets SWR fetch and revalidate. Data never flows through
   * the return value — read it from the store.
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
        ? localFirstKeys.hydrate(resource.name, resource.version, scope, key!)
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
      () => fetcher!(params!),
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
    dispatch,
    ensureScope,
    getConfirmed,
    hydrate,
    optimistic,
    remove,
    replace,
    resource,
    revalidate,
    update,
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
  set: (state, key, data) => {
    const next = { ...(state[field] as Record<string, TData> | undefined) };
    if (data === undefined) delete next[key];
    else next[key] = data;
    return { [field]: next } as Partial<TStore>;
  },
});
