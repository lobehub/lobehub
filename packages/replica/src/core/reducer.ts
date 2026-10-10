import type {
  ReplicaEntryMeta,
  ReplicaPendingMutation,
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
      type: 'update';
    }
  | { apply: (data: T) => T; id: number; key: string; scope: string; type: 'optimistic' }
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

/** An authoritative write claims the key again, so its removal marker goes. */
const clearRemoved = <T>(state: ReplicaState<T>, key: string): ReplicaState<T> => {
  if (!state.removed?.[key]) return state;
  const removed = { ...state.removed };
  delete removed[key];
  return { ...state, removed };
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
    return { ...state, entries, scope };
  };

  switch (action.type) {
    case 'hydrate': {
      // A removal wins over a storage read that started before it: the entry is
      // gone, so a read that resolves afterwards is stale and must not restore
      // it (a server-confirmed gone group, a deleted file). Cleared by the next
      // authoritative write, so the key can come back.
      if (state.removed?.[action.key]) return noop(state);
      // Hydrate only fills an empty slot: a server-confirmed value, an optimistic
      // write or any confirmed local write always wins over storage. A
      // provisional `seed` is the one exception — it is a list row standing in
      // for a detail, not authoritative state, so the persisted value replaces
      // it. Otherwise a seeded entry would block the persisted detail forever.
      const provisionalSeed = !!entry && entry.source === 'seed' && entry.pending.length === 0;
      if (!provisionalSeed && (entry || view !== undefined)) return noop(state);
      return {
        effects: [],
        state: withEntry({
          params: action.params,
          pending: [],
          query: action.query,
          source: 'storage',
          updatedAt: action.updatedAt ?? now,
        }),
        writes: [{ data: action.data, key: action.key }],
      };
    }

    case 'replace': {
      const pending = entry?.pending ?? [];
      const next = action.data(confirmed) ?? confirmed;
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
        state: clearRemoved(nextState, action.key),
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
      return {
        effects:
          persist && nextBase !== undefined
            ? [{ data: nextBase, key: action.key, query: entry?.query, scope, type: 'persist' }]
            : [],
        state: clearRemoved(
          withEntry({
            ...entry,
            base: pending.length ? nextBase : undefined,
            pending,
            source,
            updatedAt: now,
          }),
          action.key,
        ),
        writes: nextView === view ? [] : [{ data: nextView, key: action.key }],
      };
    }

    case 'optimistic': {
      if (view === undefined) return noop(state);
      const pending = [...(entry?.pending ?? []), { apply: action.apply, id: action.id }];
      return {
        effects: [],
        state: clearRemoved(
          withEntry({
            ...entry,
            base: confirmed,
            pending,
            source: entry?.source ?? 'local',
            updatedAt: entry?.updatedAt ?? now,
          }),
          action.key,
        ),
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
        // Tombstone the key: a hydrate that started before this removal may
        // still resolve, and it must not bring the removed entry back.
        state: {
          ...withEntry(undefined),
          removed: { ...state.removed, [action.key]: true },
        },
        writes: view === undefined ? [] : [{ data: undefined, key: action.key }],
      };
    }
  }
};
