import { useEffect, useLayoutEffect, useRef } from 'react';

import { stableQueryKey } from '../core/defineReplica';
import { createReplicaEngine, type ReplicaEngineOptions } from '../core/engine';
import { isReplicaSyncKey, replicaKeys } from '../core/keys';
import type { ReplicaPagedData } from '../core/paging';
import type { ReplicaViewWrite } from '../core/reducer';
import { DEFAULT_REMOVAL_TOMBSTONE_LIMIT } from '../core/tombstones';
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
  /**
   * Side effects of the resource itself, run by every head response — a
   * mounted `useSync` and an imperative `fetch` alike — after the response is
   * folded in (see {@link ReplicaEffects}).
   */
  effects?: ReplicaEffects<TParams, TFetched>;
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
  /**
   * Whether the captured `scope` is still the one the store is on. A failure
   * with `isActive: false` belongs to an identity / workspace the store has
   * left: surface it on the *current* view only when this is true, while still
   * using the captured `key` / `scope` to clean up the scope it came from.
   */
  isActive: boolean;
  /** The entry key the read was for; `undefined` for a disabled read. */
  key: string | undefined;
  /** The cache scope the read was captured under. */
  scope: string;
}

/** Where a settled head response was captured, for {@link ReplicaEffects}. */
export interface ReplicaSettleContext {
  key: string;
  /** The cache scope the request was captured under (the active one, except for `onPurge`). */
  scope: string;
  /** Which path requested it: a mounted `useSync`, or `slice.fetch`. */
  source: 'fetch' | 'sync';
}

/**
 * Resource-level side effects of head responses. Unlike `useSync`'s per-call
 * `onSuccess` / `onError` (UI callbacks of one mounted view), these run for
 * every response the resource settles, whichever path requested it — so a
 * store that fetches while no view is mounted keeps the same side effects.
 *
 * They run only for a response that passed every guard (clear, removal, active
 * query, a newer response already applied) and, for `onApplied` / `onMissing`,
 * only when its captured scope is still the active one.
 */
export interface ReplicaEffects<TParams, TFetched> {
  /**
   * A response was folded into the active scope (`prepareHead` kept it and it
   * is not a terminal absence). Runs even when the value did not change.
   */
  onApplied?: (data: TFetched, params: TParams, context: ReplicaSettleContext) => void;
  /**
   * A failed head read. Like `useSync`'s `onError`, it is forwarded off-scope
   * too, with `isActive: false`: use the captured key / scope to clean up that
   * scope, and touch the view on screen only when `isActive`.
   */
  onError?: (error: unknown, params: TParams, context: ReplicaSyncErrorContext) => void;
  /**
   * The response was a terminal absence (`isMissing`) and the entry was
   * removed from the active scope. An absence captured under a scope the store
   * has left purges that scope's row and runs `onPurge` instead.
   */
  onMissing?: (params: TParams, context: ReplicaSettleContext) => void;
  /**
   * A terminal absence captured under a scope the store has since left. The
   * entry's row in that scope is already purged; purge what other resources
   * keep of it there (a linked list row). Never touch the view on screen.
   */
  onPurge?: (params: TParams, context: ReplicaSettleContext) => void;
  /**
   * Every successful response, including one the guards discard (cleared or
   * removed entry, superseded query, off-scope) and one `prepareHead` drops.
   * Use it for per-request bookkeeping that must be released even when the
   * response is never folded. Not called for errors.
   */
  onSettled?: (data: TFetched, params: TParams, context: ReplicaSettleContext) => void;
}

export interface ReplicaFetchOptions {
  /**
   * Start a new request even when one for the same entry is in flight, and
   * retire every request started before it: a late response of an older one
   * is dropped instead of applied. Use it for refreshes after a mutation,
   * where an in-flight request may hold the pre-mutation value. By default
   * `fetch` joins the request in flight (a `useSync` one or another `fetch`).
   */
  fresh?: boolean;
  /**
   * The cache scope the fetch belongs to, captured by a caller that started a
   * multi-step flow earlier (a warmup fanning out from a parent response). The
   * response settles into that scope under the same off-scope rules as any
   * other. When the scope is no longer active the fetch rejects without a
   * request: it would read the new identity's data under the old one's label.
   * Defaults to the active scope.
   */
  scope?: string;
}

export interface ReplicaFetchResult<TFetched> {
  /**
   * Whether the response was settled into the active scope: folded in, or
   * applied as a terminal absence. `false` when a guard dropped it (scope
   * switch, `remove` / `clear` mid-flight, superseded) or `prepareHead` did.
   */
  applied: boolean;
  /** The response as fetched, also when it was not applied. */
  data: TFetched;
  /** The response was a terminal absence (`isMissing`), in whichever scope. */
  missing: boolean;
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
   * (e.g. adopting an active id). UI callbacks of this view only: effects every
   * response of the resource needs belong in the slice's `effects`, which
   * `fetch` runs too.
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

/** `slice.fetch` was asked to fetch for a scope that is no longer active. */
export class ReplicaScopeChangedError extends Error {
  constructor(name: string, scope: string) {
    super(`[replica] ${name}: scope ${scope} is no longer active`);
    this.name = 'ReplicaScopeChangedError';
  }
}

/** One head request, from `begin` to `settle`. */
interface ReplicaRequest<TParams, TFetched> {
  /** `clear()` generation of `scope` when the request started. */
  clearGeneration: number;
  key: string;
  params: TParams;
  /** Settles the request; set once it is sent. */
  promise?: Promise<TFetched>;
  /** Row key of the query it asks for (`headQuery` guard). */
  queryKey: string;
  /** `remove` generation of `scope` + `key` when the request started. */
  removalGeneration: number;
  /** Scope + sync key: requests of the same id dedupe and supersede each other. */
  requestId: string;
  /** The cache scope it was captured under. */
  scope: string;
  /** Start order across the slice. */
  seq: number;
  /** What it settled to; a request is settled once (a joined fetch and its sync share it). */
  settled?: ReplicaSettled;
  /** The response (or failure) it settled with. */
  settledWith?: unknown;
  source: 'fetch' | 'sync';
  syncKey: readonly unknown[];
}

interface ReplicaSettled {
  /** Settled into the active scope (folded in or removed as missing). */
  applied: boolean;
  /** Passed every guard; `isActive` says whether its scope is still on screen. */
  current: boolean;
  isActive: boolean;
  missing: boolean;
}

type ReplicaOutcome<TFetched> = { data: TFetched } | { error: unknown };

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
    effects,
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
  const {
    applyHead,
    clearGeneration,
    ensureScope,
    fetcher,
    hydrate,
    isMissingHead,
    removalGeneration,
    retain,
  } = engine;

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
   * Entries (`scope` + key) whose one-shot hydration actually painted a
   * persisted row. The hydration query settles `true` on a cache miss too, so
   * a reactivated key may only replay `onHydrated` when its row really came from
   * storage — not off a provisional seed or another source that happens to sit
   * in the view.
   */
  const hydratedEntries = new Set<string>();
  const hydratedEntryId = (scope: string, key: string) => `${scope}\u0000${key}`;

  // ---- one settle pipeline ---------------------------------------------
  // Every head response — a mounted `useSync`, or `fetch` with no view mounted
  // — is captured by `begin` when its request starts and folded in by `settle`,
  // so every path applies the same guards and the same resource effects.

  let requestSeq = 0;

  /**
   * Requests whose start order is at or below this number are retired, per
   * request id: a newer response already applied, or a `fresh` fetch started
   * after them. Their late response would repaint an older value.
   *
   * An entry only matters while a request it retires is still unsettled:
   * every request started later has a higher sequence, so a missing entry
   * (read as 0) admits exactly the same responses. Entries are pruned as soon
   * as no sent request at or below them is pending, so the map holds only the
   * ids with an older request in flight.
   */
  const retiredThrough = new Map<string, number>();
  /** Sequences of the sent requests that have not settled yet, per request id. */
  const unsettled = new Map<string, Set<number>>();

  /** Drop the retirement of `requestId` once no request it retires is pending. */
  const pruneRetired = (requestId: string) => {
    const through = retiredThrough.get(requestId);
    if (through === undefined) return;
    for (const seq of unsettled.get(requestId) ?? []) if (seq <= through) return;
    retiredThrough.delete(requestId);
  };

  const retire = (requestId: string, seq: number) => {
    if ((retiredThrough.get(requestId) ?? 0) < seq) retiredThrough.set(requestId, seq);
    pruneRetired(requestId);
    // Backstop: never more ids than a removal tombstone window. Only an entry
    // with no older request pending may go — evicting one that still retires
    // a request in flight would let its stale response win.
    if (retiredThrough.size <= DEFAULT_REMOVAL_TOMBSTONE_LIMIT) return;
    for (const id of retiredThrough.keys()) {
      pruneRetired(id);
      if (retiredThrough.size <= DEFAULT_REMOVAL_TOMBSTONE_LIMIT) return;
    }
  };

  const trackUnsettled = ({ requestId, seq }: ReplicaRequest<TParams, TFetched>) => {
    const pending = unsettled.get(requestId) ?? new Set<number>();
    unsettled.set(requestId, pending);
    pending.add(seq);
  };

  const untrackUnsettled = ({ requestId, seq }: ReplicaRequest<TParams, TFetched>) => {
    const pending = unsettled.get(requestId);
    if (!pending?.delete(seq)) return;
    if (pending.size === 0) unsettled.delete(requestId);
    pruneRetired(requestId);
  };

  /** The latest request in flight per id, which a non-`fresh` `fetch` joins. */
  const inflight = new Map<string, ReplicaRequest<TParams, TFetched>>();
  /** `useSync` requests in flight per id (`fetch` seeds the driver only while none is). */
  const syncInflight = new Map<string, number>();

  /**
   * `useSync` request each sync id last started, settled by the driver's
   * callback. The driver settles one request per key at a time (a newer
   * request supersedes the older one), so the latest start is the one that
   * settles.
   */
  const syncRequests = new Map<string, ReplicaRequest<TParams, TFetched>>();

  const syncKeyOf = (params: TParams, scope: string, key: string) =>
    resource.syncKey?.(params) ??
    replicaKeys.sync(resource.name, resource.version, scope, key, params);

  /** Capture what a head request for `params` started under. */
  const begin = (
    params: TParams,
    scope: string,
    source: 'fetch' | 'sync',
  ): ReplicaRequest<TParams, TFetched> => {
    const key = resource.key(params);
    const syncKey = syncKeyOf(params, scope, key);
    return {
      clearGeneration: clearGeneration(scope),
      key,
      params,
      queryKey: resource.storageKey(params),
      removalGeneration: removalGeneration(scope, key),
      requestId: `${scope}\u0000${stableQueryKey(syncKey)}`,
      scope,
      seq: ++requestSeq,
      source,
      syncKey,
    };
  };

  /** Send the request and track it in flight until it settles. */
  const send = (request: ReplicaRequest<TParams, TFetched>) => {
    const { requestId } = request;
    const sent = fetcher!(request.params, undefined);
    // Tolerate a fetcher (a test double) that does not return a promise: the
    // driver still gets exactly what it returned.
    const promise = Promise.resolve(sent);
    request.promise = promise;
    // Until it settles, a retirement that covers it must be kept.
    trackUnsettled(request);
    inflight.set(requestId, request);
    if (request.source === 'sync')
      syncInflight.set(requestId, (syncInflight.get(requestId) ?? 0) + 1);
    const done = () => {
      if (inflight.get(requestId) === request) inflight.delete(requestId);
      if (request.source !== 'sync') return;
      const count = (syncInflight.get(requestId) ?? 1) - 1;
      if (count > 0) syncInflight.set(requestId, count);
      else syncInflight.delete(requestId);
    };
    promise.then(done, done);
    // A `useSync` request settles on its own response, not only through the
    // driver's callback: a driver skips that callback once the hook moved to
    // another key, unmounted, or a newer request superseded it — and the
    // resource effects (a terminal absence, a purge) must not depend on which
    // view is still mounted. The callback then reads the memoized result.
    if (request.source === 'sync')
      promise.then(
        (data) => settle(request, { data }),
        (error: unknown) => settle(request, { error }),
      );
    return sent;
  };

  /**
   * Whether the request still answers the query its entry shows. A `useSync`
   * request must match the query the entry last asked for (see `headQuery`). A
   * `fetch` may also land with no view mounted, but never over a view that
   * shows another query of the key.
   */
  const isActiveQuery = ({ key, queryKey, source }: ReplicaRequest<TParams, TFetched>) => {
    const head = headQuery.get(key);
    return source === 'sync' ? head === queryKey : head === undefined || head === queryKey;
  };

  const settleOnce = (
    request: ReplicaRequest<TParams, TFetched>,
    outcome: ReplicaOutcome<TFetched>,
  ): ReplicaSettled => {
    const { key, params, scope } = request;
    /**
     * Whether the entry is still on the scope the request was captured under.
     *
     * A response can settle after an identity/workspace switch. `replace` drops
     * it — the engine refuses off-scope actions — but no side effect may run
     * either: it carries the previous identity's state (onboarding redirect,
     * display snapshot, analytics identify, settings writes). The captured
     * key/scope is not enough on its own, because a switch to a scope that
     * reads the same key/query satisfies the other guards.
     */
    const isActive = resource.scope.get() === scope;
    const dropped: ReplicaSettled = { applied: false, current: false, isActive, missing: false };

    // Discard a response that started before a `clear()` of its scope or a
    // `remove` of its entry (it holds wiped data), one for a query the entry
    // has moved past (the newer query owns the view, see `headQuery`), and one
    // older than a response already applied or a `fresh` fetch.
    if (
      request.clearGeneration !== clearGeneration(scope) ||
      request.removalGeneration !== removalGeneration(scope, key) ||
      request.seq <= (retiredThrough.get(request.requestId) ?? 0) ||
      !isActiveQuery(request)
    ) {
      if (!('error' in outcome)) {
        // A discarded success still settles the request; release any
        // per-request bookkeeping even though it is never folded.
        effects?.onSettled?.(outcome.data, params, { key, scope, source: request.source });
      }
      return dropped;
    }

    if ('error' in outcome) {
      // Forwarded even off-scope: the captured `key`/`scope` lets a consumer
      // purge that scope's row (a late NOT_FOUND / FORBIDDEN) without touching
      // the scope on screen; `isActive` tells it whether the failure also
      // belongs to the view on screen.
      effects?.onError?.(outcome.error, params, { isActive, key, scope });
      return { ...dropped, current: true };
    }

    // Every successful response releases per-request bookkeeping, including
    // one that ends up off-scope or is dropped by `prepareHead` below.
    effects?.onSettled?.(outcome.data, params, { key, scope, source: request.source });

    if (!isActive) {
      // Off-scope: never fold a value into the scope on screen. A terminal
      // absence still purges its own scope's row (`remove` routes it there), so
      // a switch back cannot hydrate a value the server no longer has.
      const missing = isMissingHead(outcome.data);
      if (missing) {
        remove(key, scope);
        effects?.onPurge?.(params, { key, scope, source: request.source });
      }
      return { ...dropped, current: true, missing };
    }

    retire(request.requestId, request.seq - 1);
    const { outcome: folded } = applyHead(params, outcome.data, scope);
    const context: ReplicaSettleContext = { key, scope, source: request.source };
    if (folded === 'replaced') effects?.onApplied?.(outcome.data, params, context);
    else if (folded === 'missing') effects?.onMissing?.(params, context);
    return {
      applied: folded !== 'dropped',
      current: true,
      isActive,
      missing: folded === 'missing',
    };
  };

  /**
   * Fold a settled head request into the replica: apply every guard, then
   * `replace` / remove a terminal absence (in the captured scope) / purge one
   * captured off-scope, then run the resource effects. A request is settled
   * once: a `fetch` that joined a `useSync` request shares its result.
   */
  const settle = (
    request: ReplicaRequest<TParams, TFetched>,
    outcome: ReplicaOutcome<TFetched>,
  ): ReplicaSettled => {
    if (request.settled) return request.settled;
    request.settledWith = 'error' in outcome ? outcome.error : outcome.data;
    request.settled = settleOnce(request, outcome);
    untrackUnsettled(request);
    if (request.source === 'sync') releaseSyncRequest(request);
    return request.settled;
  };

  /**
   * Drop a settled `useSync` request's record once its driver callback had its
   * chance to read it. The record is normally taken by that callback, but the
   * driver skips it when the hook changed key, unmounted or was superseded —
   * the request still settles on its own promise, and its record (holding the
   * response) must not stay behind. A driver runs the callback in the same
   * turn the response resolves (SWR does, in microtasks), so a macrotask later
   * the record is only a leak.
   */
  const releaseSyncRequest = (request: ReplicaRequest<TParams, TFetched>) => {
    setTimeout(() => {
      if (syncRequests.get(request.requestId) === request) syncRequests.delete(request.requestId);
    }, 0);
  };

  /**
   * Fetch the head of an entry now and settle it like a `useSync` response —
   * for stores that need the data while no view is mounted (a hover prefetch,
   * a refresh after a mutation on a route without the list). `revalidate` only
   * re-runs mounted queries.
   *
   * Joins a request in flight for the same entry unless `fresh`. Resolves with
   * what was fetched and whether it was applied; rejects when the request
   * fails, after routing the failure through `effects.onError`.
   */
  const fetch = async (
    params: TParams,
    { fresh = false, scope = resource.scope.get() }: ReplicaFetchOptions = {},
  ): Promise<ReplicaFetchResult<TFetched>> => {
    if (!fetcher) throw new Error(`[replica] ${resource.name} has no fetcher`);
    if (scope !== resource.scope.get()) throw new ReplicaScopeChangedError(resource.name, scope);
    let request = begin(params, scope, 'fetch');
    const joined = fresh ? undefined : inflight.get(request.requestId);
    if (joined) request = joined;
    else {
      if (fresh) retire(request.requestId, request.seq - 1);
      send(request);
    }

    let data: TFetched;
    try {
      data = await request.promise!;
    } catch (error) {
      settle(request, { error });
      throw error;
    }
    const settled = settle(request, { data });
    // Seed the driver's cache with what this fetch applied, unless a `useSync`
    // request of the key is in flight: it fills the cache itself, and a write
    // overtaking it could make the driver discard its newer response.
    if (settled.applied && request.source === 'fetch' && !syncInflight.has(request.requestId))
      driver.seed?.(request.syncKey, data);
    return { applied: settled.applied, data, missing: settled.missing };
  };

  /**
   * Forget the key's head query as well as the entry. A `useSync` request
   * already in flight for it would otherwise pass the settle guards (the
   * marker still matches), `replace` the entry and persist pre-mutation rows
   * back over an invalidation that has already completed. (The engine's
   * removal generation drops a `fetch` captured before the removal.)
   */
  const remove = (key: string, scope?: string) => {
    // Only the active scope's marker belongs to the entry on screen; an
    // off-scope removal (see `engine.remove`) must not drop it.
    if (scope === undefined || scope === resource.scope.get()) headQuery.delete(key);
    return engine.remove(key, scope);
  };

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

    // Pin the entry on screen against eviction (`persist.maxEntries`).
    useLayoutEffect(() => {
      if (active && key !== undefined && queryKey !== undefined) return retain(key, queryKey);
    }, [active, key, queryKey]);

    // The entry this hook currently asks for. A hydrate that resolves after the
    // hook moved to another key still fills its own cache entry (harmless), but
    // it must not replay `onHydrated`: those side effects act on the *current*
    // view, so they would re-adopt a superseded object (e.g. navigate g1 → g2
    // while g1's storage read is slow, then g1's hydrate resets the active group
    // back to g1's supervisor).
    const activeKey = useRef<string | undefined>(undefined);
    // The entry (scope + key) whose hydration side effects already ran in its
    // current activation. Reset on every key or scope change, so an entry that
    // comes back (g1 → g2 → g1, or scope A → B → A with the same key) gets them
    // replayed even though its `once` hydration is not re-run.
    const hydratedKey = useRef<string | undefined>(undefined);
    useLayoutEffect(() => {
      activeKey.current = active ? key : undefined;
      hydratedKey.current = undefined;
    }, [active, key, scope]);

    const hydration = driver.useQuery<boolean>(
      active && resource.persisted && resource.persistKey(key!)
        ? replicaKeys.hydrate(resource.name, resource.version, scope, resource.storageKey(params!))
        : null,
      async () => {
        const didHydrate = await hydrate(params!, scope);
        if (didHydrate) hydratedEntries.add(hydratedEntryId(scope, key!));
        // A superseded key (the hook moved on) runs no side effects at all.
        if (activeKey.current !== key) return true;
        hydratedKey.current = hydratedEntryId(scope, key!);
        // A persisted row is a successful value with no network response: replay
        // the success side effects off it, so an offline / slow first paint still
        // adopts the roster and settles the flags the response path would.
        if (didHydrate) {
          const hydrated = view.get(get(), key!);
          if (hydrated !== undefined) onHydrated?.(hydrated);
        }
        return true;
      },
      { once: true },
    );

    // Reactivating a key whose hydration already settled: the driver reuses the
    // `once` result and the fetcher above does not run, so replay the side
    // effects off the value in memory. Without it, returning to g1 offline
    // leaves them acting on g2 until a response lands (or forever, offline).
    useEffect(() => {
      if (!active || key === undefined || hydration.data !== true) return;
      const entry = hydratedEntryId(scope, key);
      if (hydratedKey.current === entry) return;
      hydratedKey.current = entry;
      const current = view.get(get(), key);
      if (current !== undefined) {
        // A lookup that missed storage hydrated nothing to replay.
        if (hydratedEntries.has(entry)) onHydrated?.(current);
        return;
      }
      // Back on a scope whose view `ensureScope` cleared (A → B → A): the cached
      // `once` result means the fetcher will not read storage again, so read it
      // here — otherwise a row still in A's partition stays off screen while
      // the network is slow or offline.
      void hydrate(params!, scope).then((didHydrate) => {
        if (!didHydrate) return;
        hydratedEntries.add(entry);
        if (activeKey.current !== key || resource.scope.get() !== scope) return;
        const hydrated = view.get(get(), key);
        if (hydrated !== undefined) onHydrated?.(hydrated);
      });
    }, [active, key, scope, hydration.data]);

    const syncKey = active && fetcher ? syncKeyOf(params!, scope, key!) : null;
    /** The request settling now: the one this sync id last started. */
    const takeRequest = (response: unknown) => {
      const requestId = `${scope}\u0000${stableQueryKey(syncKey)}`;
      const request = syncRequests.get(requestId);
      syncRequests.delete(requestId);
      // The request already settled on its own response, and the driver now
      // reports that same response: read the memoized result.
      if (request && (!request.settled || request.settledWith === response)) return request;
      // A response the driver settles without having run our fetcher (a
      // cache-shared key), or one the recorded request did not produce, is
      // captured now: nothing it started under is known.
      return begin(params!, scope, 'sync');
    };

    const sync = driver.useQuery<TFetched>(
      syncKey,
      () => {
        const request = begin(params!, scope, 'sync');
        syncRequests.set(request.requestId, request);
        return send(request);
      },
      {
        ...schedule,
        // Always installed, so a failed request is settled (and its capture
        // dropped) even when the caller has no error side effects. A failure
        // of a query the entry has moved past (or of a request from before a
        // clear) never surfaces on the query now on screen; an off-scope one is
        // still forwarded with the captured key/scope (see `settle`).
        onError: (error: unknown) => {
          const settled = settle(takeRequest(error), { error });
          if (settled.current) onError?.(error, { isActive: settled.isActive, key, scope });
        },
        onSuccess: (data) => {
          const settled = settle(takeRequest(data), { data });
          if (!settled.current || !settled.isActive) return;
          // A key the hook has moved past (g1 → g2 while g1's request is in
          // flight): the response still fills g1's own entry, but this view's
          // side effects would re-adopt g1 over the g2 view.
          if (activeKey.current !== key) return;
          onSuccess?.(data);
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

  return {
    ...engine,
    /** @internal Records of `useSync` requests not yet released (leak checks in tests). */
    debugPendingSyncRequests: () => syncRequests.size,
    /** @internal Retirement records still held (leak checks in tests). */
    debugRetiredRequests: () => retiredThrough.size,
    fetch,
    remove,
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
