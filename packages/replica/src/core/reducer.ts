import type {
  ReplicaEntryMeta,
  ReplicaPendingMutation,
  ReplicaSeedPatch,
  ReplicaSource,
  ReplicaState,
} from './types';

/**
 * Pure transition core of a replica. It never touches the store
 * or storage: it returns the next bookkeeping slot, the view writes the store
 * binding must apply, and the persistence effects it must run.
 *
 * The VIEW (what selectors read) lives in the domain store, wherever the
 * binding's lens puts it. The reducer only reads it through `readView`, so a
 * domain can keep its existing state shape (e.g. `topicDataMap`).
 */
export type ReplicaAction<T> =
  | {
      data: T;
      key: string;
      /**
       * Repaint a slot that answers a *different* query from the persisted page
       * (a navigation). Only the caller that knows the entry has moved on
       * (the requested query changed) may ask for it; by default a hydrate only
       * fills an empty slot.
       */
      overwrite?: boolean;
      params?: unknown;
      query?: string;
      scope: string;
      type: 'hydrate';
      updatedAt?: number;
    }
  | {
      /** Receives the confirmed value (base or view); `undefined` keeps it. */
      data: (confirmed: T | undefined) => T | undefined;
      key: string;
      params?: unknown;
      query?: string;
      scope: string;
      type: 'replace';
    }
  | {
      apply: (data: T | undefined) => T | undefined;
      key: string;
      persist: boolean;
      scope: string;
      /** Marks a provisional write (`'seed'`); defaults to the entry's own source. */
      source?: ReplicaSource;
      /**
       * Seed writes of one source (a list refresh, a session refresh). A later
       * seed write supersedes an earlier one of the same tag since the last
       * confirmed write, so a remembered seed history stays bounded.
       */
      seedTag?: string;
      type: 'update';
    }
  | {
      apply: (data: T) => T;
      id: number;
      key: string;
      /** Query the overlay is started under (see `ReplicaPendingMutation`). */
      query?: string;
      scope: string;
      type: 'optimistic';
    }
  | { confirm?: (data: T) => T; id: number; key: string; scope: string; type: 'commit' }
  | { id: number; key: string; scope: string; type: 'rollback' }
  | { key: string; scope: string; type: 'remove' }
  | { scope: string; type: 'resetScope' };

export type ReplicaEffect<T> =
  | { data: T; key: string; query?: string; scope: string; type: 'persist' }
  | { key: string; query?: string; scope: string; type: 'remove' };

export type ReplicaViewWrite<T> = { data: T | undefined; key: string } | { type: 'clear' };

export interface ReplicaTransition<T> {
  effects: ReplicaEffect<T>[];
  state: ReplicaState<T>;
  writes: ReplicaViewWrite<T>[];
}

export const createReplicaState = <T>(): ReplicaState<T> => ({ entries: {} });

const materialize = <T>(
  base: T | undefined,
  pending: ReplicaPendingMutation<T>[],
): T | undefined =>
  base === undefined
    ? undefined
    : pending.reduce<T>((data, mutation) => mutation.apply(data), base);

const noop = <T>(state: ReplicaState<T>): ReplicaTransition<T> => ({
  effects: [],
  state,
  writes: [],
});

/**
 * Drop the seed patches a new seed write of `tag` supersedes: those of the same
 * tag after the last confirmed patch. Repeated refreshes of one source then keep
 * one patch instead of one per refresh, while the order relative to confirmed
 * writes (and to other sources' seeds) is preserved.
 */
const coalesceSeedPatches = <T>(
  patches: ReplicaSeedPatch<T>[],
  isSeedWrite: boolean,
  tag: string | undefined,
): ReplicaSeedPatch<T>[] => {
  if (!isSeedWrite) return patches;
  let lastConfirmed = -1;
  patches.forEach((patch, index) => {
    if (!patch.seed) lastConfirmed = index;
  });
  return patches.filter(
    (patch, index) => index <= lastConfirmed || !patch.seed || patch.tag !== tag,
  );
};

export const replicaReducer = <T>(
  state: ReplicaState<T>,
  action: ReplicaAction<T>,
  readView: (key: string) => T | undefined,
  now: number = Date.now(),
): ReplicaTransition<T> => {
  if (action.type === 'resetScope') {
    if (state.scope === action.scope) return noop(state);
    // A different identity owns memory now: drop every entry (and its view) of
    // the previous scope instead of letting it bleed into the new one.
    return {
      effects: [],
      state: { entries: {}, scope: action.scope },
      writes: state.scope === undefined ? [] : [{ type: 'clear' }],
    };
  }

  // Late results from another scope (workspace switch, logout) are ignored.
  if (state.scope !== undefined && state.scope !== action.scope) return noop(state);

  const scope = action.scope;
  const entry = state.entries[action.key];
  const view = readView(action.key);
  const confirmed = entry?.pending.length ? entry.base : view;
  const withEntry = (next: ReplicaEntryMeta<T> | undefined): ReplicaState<T> => {
    const entries = { ...state.entries };
    if (next) entries[action.key] = next;
    else delete entries[action.key];
    return { entries, scope };
  };

  switch (action.type) {
    case 'hydrate': {
      // A removed key never reaches here: the engine's removal tombstones drop a
      // storage read that resolves after a removal (see `hydrate` in engine.ts).
      // Hydrate only fills an empty slot: a server-confirmed value, an
      // optimistic write or any local write always wins over storage. A caller
      // that knows the slot answers a *different* query (a navigation) may ask
      // to repaint it from that query's persisted page instead — the overlays it
      // drops belong to the query being left. An overlay whose query is unknown
      // still wins: we cannot prove it is not this query's.
      //
      // A provisional `seed` is the other exception — it is a list row standing
      // in for a detail, not authoritative state, so the persisted value
      // replaces it. Otherwise a seeded entry would block the persisted detail
      // forever.
      const provisionalSeed = !!entry && entry.source === 'seed' && entry.pending.length === 0;
      if (entry && !provisionalSeed) {
        if (
          !action.overwrite ||
          entry.query === action.query ||
          entry.pending.some((mutation) => mutation.query === undefined)
        )
          return noop(state);
      } else if (!entry && view !== undefined) {
        return noop(state);
      }
      // The writes made over the seed are replayed onto the stored value, so
      // storage cannot clobber them: the seed's own (fresher) fields — a list
      // row's renamed title — and any confirmed edit made before storage
      // answered. Only a confirmed edit makes the result a local value (and
      // persists it); seed writes stay in-memory.
      const patches = (provisionalSeed && entry.seedPatches) || [];
      const data = patches.reduce((value, patch) => patch.apply(value) ?? value, action.data);
      const confirmedPatches = patches.filter((patch) => !patch.seed);
      return {
        effects: confirmedPatches.some((patch) => patch.persist)
          ? [{ data, key: action.key, query: action.query, scope, type: 'persist' }]
          : [],
        state: withEntry({
          params: action.params,
          pending: [],
          query: action.query,
          source: confirmedPatches.length ? 'local' : 'storage',
          updatedAt: confirmedPatches.length ? now : (action.updatedAt ?? now),
        }),
        writes: [{ data, key: action.key }],
      };
    }

    case 'replace': {
      // An overlay only describes the query it was started under, so a replace
      // for another query drops it instead of reapplying it: its base belongs to
      // the old query, and a later commit would insert that query's row here.
      const pending = (entry?.pending ?? []).filter(
        (mutation) => mutation.query === undefined || mutation.query === action.query,
      );
      // The merge basis under a query change is the old query's confirmed value
      // (never the view, which may still carry a dropped overlay).
      const basis = entry && entry.query !== action.query ? (entry.base ?? view) : confirmed;
      const next = action.data(basis) ?? basis;
      const query = 'query' in action ? action.query : entry?.query;
      const nextState = withEntry({
        base: pending.length ? next : undefined,
        params: action.params ?? entry?.params,
        pending,
        query,
        source: 'server',
        updatedAt: now,
      });
      if (next === undefined) return { effects: [], state: nextState, writes: [] };
      // In-flight optimistic mutations are rebased onto the fresh server value
      // so a background revalidation never flickers them away.
      const nextView = materialize(next, pending);
      return {
        effects: [{ data: next, key: action.key, query, scope, type: 'persist' }],
        state: nextState,
        writes: nextView === view ? [] : [{ data: nextView, key: action.key }],
      };
    }

    case 'update': {
      const nextView = action.apply(view);
      const pending = entry?.pending ?? [];
      const nextBase = pending.length ? action.apply(entry!.base) : nextView;
      if (nextView === view && nextBase === confirmed) return noop(state);
      // A provisional seed is never authoritative, so it must not persist: it
      // only stands in for a value another source owns, and persisting it would
      // overwrite that value's persisted row. A `seed` also only ever marks a
      // fresh slot — a value already in memory (written outside the binding) is
      // authoritative and is never downgraded to a seed.
      const source: ReplicaSource =
        entry?.source ?? (view === undefined ? (action.source ?? 'local') : 'local');
      const persist = action.persist && source !== 'seed';
      // Every write while the entry is a seed is remembered so a hydrate that
      // replaces the seed replays it (see `hydrate`): a confirmed write keeps
      // the seed provisional, and a seed write carries fresher fields.
      const isSeedWrite = action.source === 'seed';
      const seedPatches =
        source === 'seed'
          ? [
              ...coalesceSeedPatches(entry?.seedPatches ?? [], isSeedWrite, action.seedTag),
              {
                apply: action.apply,
                persist: !isSeedWrite && action.persist,
                ...(isSeedWrite && { seed: true, tag: action.seedTag }),
              },
            ]
          : entry?.seedPatches;
      return {
        effects:
          persist && nextBase !== undefined
            ? [{ data: nextBase, key: action.key, query: entry?.query, scope, type: 'persist' }]
            : [],
        state: withEntry({
          ...entry,
          base: pending.length ? nextBase : undefined,
          pending,
          seedPatches,
          source,
          updatedAt: now,
        }),
        writes: nextView === view ? [] : [{ data: nextView, key: action.key }],
      };
    }

    case 'optimistic': {
      if (view === undefined) return noop(state);
      const pending = [
        ...(entry?.pending ?? []),
        { apply: action.apply, id: action.id, query: action.query },
      ];
      return {
        effects: [],
        state: withEntry({
          ...entry,
          base: confirmed,
          pending,
          source: entry?.source ?? 'local',
          updatedAt: entry?.updatedAt ?? now,
        }),
        writes: [{ data: action.apply(view), key: action.key }],
      };
    }

    case 'commit':
    case 'rollback': {
      const mutation = entry?.pending.find((item) => item.id === action.id);
      if (!entry || !mutation) return noop(state);
      const pending = entry.pending.filter((item) => item.id !== action.id);
      const base =
        action.type === 'commit' && entry.base !== undefined
          ? (action.confirm ?? mutation.apply)(entry.base)
          : entry.base;
      // A plain commit confirms what the view already shows; only a rollback or
      // a server-provided `confirm` needs the view rebuilt from the base.
      const nextView =
        action.type === 'commit' && !action.confirm ? view : materialize(base, pending);
      return {
        effects:
          action.type === 'commit' && base !== undefined
            ? [{ data: base, key: action.key, query: entry.query, scope, type: 'persist' }]
            : [],
        state: withEntry({
          ...entry,
          base: pending.length ? base : undefined,
          pending,
          source: entry.source,
          updatedAt: action.type === 'commit' ? now : entry.updatedAt,
        }),
        writes: nextView === view ? [] : [{ data: nextView, key: action.key }],
      };
    }

    case 'remove': {
      return {
        effects: [{ key: action.key, query: entry?.query, scope, type: 'remove' }],
        state: withEntry(undefined),
        writes: view === undefined ? [] : [{ data: undefined, key: action.key }],
      };
    }
  }
};
