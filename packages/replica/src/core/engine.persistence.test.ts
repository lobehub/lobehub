import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver } from '../../tests/testDriver';
import { createReplicaSlice, recordLens } from '../zustand/createReplicaSlice';
import { defineReplica } from './defineReplica';
import { createReplicaEngine, REPLICA_INDEX_KEY, type ReplicaStorePort } from './engine';
import { arrayEntity } from './entityAdapters';
import { createReplicaState } from './reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from './types';

interface Item {
  id: string;
}

const SCOPE = 'u1';
const scopeState = { current: SCOPE, trusted: true };
const scope: ReplicaScope = {
  canPersist: () => scopeState.trusted,
  get: () => scopeState.current,
  use: () => scopeState.current,
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const item = (id: string): Item => ({ id });

/**
 * In-memory storage keyed like the app adapters. `strict: false` builds a
 * legacy adapter without `getStrict`; `failReads` makes reads of the listed row
 * keys fail the way the app adapters do (`get` swallows into a miss,
 * `getStrict` rejects).
 */
const createStorage = ({ strict = true }: { strict?: boolean } = {}) => {
  const rows = new Map<string, ReplicaRow<any>>();
  const failReads = new Set<string>();
  const failRemoves = new Set<string>();
  const failSets = new Set<string>();
  const writes: string[] = [];
  const id = ({ queryKey, scope }: { queryKey: string; scope: string }) => `${scope}|${queryKey}`;
  const storage: ReplicaStorage<any> = {
    get: async (key) => (failReads.has(key.queryKey) ? undefined : rows.get(id(key))),
    remove: async (key) => {
      if (failRemoves.has(key.queryKey)) throw new Error('delete failed');
      rows.delete(id(key));
    },
    set: async (key, row) => {
      if (failSets.has(key.queryKey)) throw new Error('write failed');
      writes.push(key.queryKey);
      rows.set(id(key), row);
    },
  };
  if (strict)
    storage.getStrict = async (key) => {
      if (failReads.has(key.queryKey)) throw new Error('read failed');
      return rows.get(id(key));
    };
  const index = () => (rows.get(`${SCOPE}|${REPLICA_INDEX_KEY}`)?.data as string[]) ?? [];
  const dataKeys = () =>
    [...rows.keys()]
      .filter((key) => !key.endsWith(REPLICA_INDEX_KEY))
      .map((key) => key.slice(SCOPE.length + 1))
      .sort();
  return { dataKeys, failReads, failRemoves, failSets, index, rows, storage, writes };
};

/** Minimal host: a record of views plus the bookkeeping slot. */
const createHost = <T>() => {
  let state: ReplicaState<T> = createReplicaState<T>();
  let view: Record<string, T> = {};
  const port: ReplicaStorePort<T> = {
    commit: (writes, next) => {
      for (const write of writes) {
        if ('type' in write) view = {};
        else if (write.data === undefined) {
          const { [write.key]: _dropped, ...rest } = view;
          view = rest;
        } else view = { ...view, [write.key]: write.data };
      }
      state = next;
    },
    getState: () => state,
    keys: () => Object.keys(view),
    read: (key) => view[key],
  };
  return { port, state: () => state, view: () => view };
};

type ListParams = { id: string; q?: string };

const setupList = (
  storage: ReturnType<typeof createStorage>,
  { maxEntries }: { maxEntries?: number } = {},
) => {
  const resource = defineReplica<ListParams, Item[]>({
    key: ({ id }) => id,
    name: 'list',
    persist: { maxEntries },
    query: ({ q }) => ({ q }),
    scope,
    storage: storage.storage,
    version: 1,
  });
  const host = createHost<Item[]>();
  const engine = createReplicaEngine(resource, {
    entity: arrayEntity<Item>((entry) => entry.id),
    port: host.port,
  });
  return { engine, host, resource };
};

const resetScope = () => {
  scopeState.current = SCOPE;
  scopeState.trusted = true;
};

describe('destructive passes need a strict read', () => {
  it('fails a clear on a legacy storage without getStrict instead of reporting success', async () => {
    resetScope();
    const storage = createStorage({ strict: false });
    const first = setupList(storage);
    first.engine.replace({ id: 'a' }, [item('1')]);
    first.engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    // The index row cannot be read on this device: `get` swallows it into a miss.
    storage.failReads.add(REPLICA_INDEX_KEY);

    // A fresh session only knows the rows through the index.
    const { engine } = setupList(storage);
    expect(await engine.clear()).toBe(false);
    expect(storage.dataKeys()).toEqual(['a?{}', 'b?{}']);
    // Hydration stays off while the wipe is incomplete.
    expect(await engine.hydrate({ id: 'a' })).toBe(false);
  });

  it('keeps a removal of a legacy storage unpurged, so every later removal retries it', async () => {
    resetScope();
    const storage = createStorage({ strict: false });
    const first = setupList(storage);
    first.engine.replace({ id: 'a', q: 'x' }, [item('1')]);
    await flush();

    const { engine } = setupList(storage);
    expect(engine.remove('a')).toBe(true);
    await flush();
    // The variant is only known through the index, which cannot be read strictly.
    expect(storage.dataKeys()).toEqual(['a?{"q":"x"}']);
    // Not marked purged: the next removal is dispatched again rather than a no-op.
    expect(engine.remove('a')).toBe(true);
  });

  it('never rewrites an unreadable index as just the new key, and retries the append', async () => {
    resetScope();
    const storage = createStorage();
    const first = setupList(storage);
    first.engine.replace({ id: 'a' }, [item('1')]);
    first.engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    expect(storage.index()).toEqual(['a?{}', 'b?{}']);

    const { engine } = setupList(storage);
    storage.failReads.add(REPLICA_INDEX_KEY);
    engine.replace({ id: 'c' }, [item('3')]);
    await flush();
    // The earlier session's keys survive the failed read.
    expect(storage.index()).toEqual(['a?{}', 'b?{}']);

    storage.failReads.delete(REPLICA_INDEX_KEY);
    engine.replace({ id: 'c' }, [item('3'), item('4')]);
    await flush();
    expect(storage.index()).toEqual(['a?{}', 'b?{}', 'c?{}']);
  });
});

describe('removeEntity keeps its guard until the persisted patch lands', () => {
  /** A session that persisted `b` (holding entity `1`), then a fresh engine. */
  const persistedB = async () => {
    const storage = createStorage();
    const first = setupList(storage);
    first.engine.replace({ id: 'b' }, [item('1'), item('2')]);
    await flush();
    return { storage, ...setupList(storage) };
  };

  it('a failed index read keeps the guard, so a later hydrate strips the entity', async () => {
    resetScope();
    const { engine, host, storage } = await persistedB();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    storage.failReads.add(REPLICA_INDEX_KEY);

    engine.removeEntity('1');
    await flush();
    // The unloaded row still holds the deleted entity…
    expect(storage.rows.get(`${SCOPE}|b?{}`)?.data).toEqual([item('1'), item('2')]);

    // …but a hydrate that starts long after the failed patch never paints it.
    expect(await engine.hydrate({ id: 'b' })).toBe(true);
    expect(host.view().b).toEqual([item('2')]);
    errors.mockRestore();
  });

  it('an untrusted scope keeps the guard, and a later successful removal releases it', async () => {
    resetScope();
    const { engine, host, storage } = await persistedB();
    scopeState.trusted = false;

    engine.removeEntity('1');
    await flush();
    expect(storage.rows.get(`${SCOPE}|b?{}`)?.data).toEqual([item('1'), item('2')]);
    expect(await engine.hydrate({ id: 'b' })).toBe(true);
    expect(host.view().b).toEqual([item('2')]);

    // Once trusted, a repeated removal of an unloaded row lands its patch.
    scopeState.trusted = true;
    const fresh = setupList(storage);
    fresh.engine.removeEntity('1');
    await flush();
    expect(storage.rows.get(`${SCOPE}|b?{}`)?.data).toEqual([item('2')]);
  });
});

describe('removeEntity in a scope left behind', () => {
  it("drops the entity from that scope's rows without touching the active view", async () => {
    resetScope();
    const storage = createStorage();
    const first = setupList(storage);
    first.engine.replace({ id: 'b' }, [item('1'), item('2')]);
    await flush();

    // The UI moved to another scope, which shows its own `b`.
    scopeState.current = 'u2';
    const { engine, host } = setupList(storage);
    engine.replace({ id: 'b' }, [item('1'), item('9')]);
    await flush();

    // A late "gone" for entity 1, answered for the scope left behind.
    engine.removeEntity('1', { scope: SCOPE });
    await flush();

    // That scope's persisted row loses it; the scope on screen keeps its own.
    expect(storage.rows.get(`${SCOPE}|b?{}`)?.data).toEqual([item('2')]);
    expect(host.view().b).toEqual([item('1'), item('9')]);
    resetScope();
  });
});

describe('redundant persist writes', () => {
  const rowWrites = (storage: ReturnType<typeof createStorage>, queryKey: string) =>
    storage.writes.filter((key) => key === queryKey).length;

  it('skips a revalidation whose value equals what this session persisted', async () => {
    resetScope();
    const storage = createStorage();
    const { engine } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    // A fresh but deep-equal response.
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    expect(rowWrites(storage, 'a?{}')).toBe(1);

    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    await flush();
    expect(rowWrites(storage, 'a?{}')).toBe(2);
  });

  it('skips a revalidation equal to the row it hydrated, and writes one that differs', async () => {
    resetScope();
    const storage = createStorage();
    storage.rows.set(`${SCOPE}|a?{}`, { data: [item('1')], updatedAt: 1 });
    storage.rows.set(`${SCOPE}|b?{}`, { data: [item('old')], updatedAt: 1 });
    const { engine } = setupList(storage);
    await engine.hydrate({ id: 'a' });
    await engine.hydrate({ id: 'b' });

    engine.replace({ id: 'a' }, [item('1')]);
    engine.replace({ id: 'b' }, [item('new')]);
    await flush();
    expect(rowWrites(storage, 'a?{}')).toBe(0);
    expect(rowWrites(storage, 'b?{}')).toBe(1);
  });

  it('writes again after a failed write, a removal or a clear', async () => {
    resetScope();
    const storage = createStorage();
    const { engine } = setupList(storage);
    storage.failSets.add('a?{}');
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    storage.failSets.delete('a?{}');
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('1')]);

    engine.remove('a');
    await flush();
    expect(storage.rows.has(`${SCOPE}|a?{}`)).toBe(false);
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('1')]);

    expect(await engine.clear()).toBe(true);
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('1')]);
  });

  it('does not count an unconfirmed write as stored: a dropped write is retried', async () => {
    resetScope();
    const storage = createStorage();
    const { engine } = setupList(storage);
    // The first write of the row is slow, then fails (an aborted transaction).
    let failFirst!: () => void;
    const { set } = storage.storage;
    let held = true;
    storage.storage.set = (key, row) =>
      held && key.queryKey === 'a?{}'
        ? ((held = false),
          new Promise<void>((_, reject) => (failFirst = () => reject(new Error('aborted')))))
        : set(key, row);

    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    // A deep-equal revalidation while that write is still in flight.
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    failFirst();
    await flush();

    // The second persist was not skipped: the row holds the value.
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('1')]);

    // Once a write is confirmed, an equal revalidation is skipped again.
    const writes = rowWrites(storage, 'a?{}');
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    expect(rowWrites(storage, 'a?{}')).toBe(writes);
  });

  it('writes again after an entity patch rewrote the row behind it', async () => {
    resetScope();
    const storage = createStorage();
    const { engine } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    // The entry moves on to another query: the first row is no longer loaded.
    engine.replace({ id: 'a', q: 'x' }, [item('2')]);
    await flush();

    engine.updateEntity<Item>('1', () => ({ id: '1', renamed: true }) as Item);
    await flush();
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([
      { id: '1', renamed: true },
      item('2'),
    ]);

    // Back to the first query with the original value: the row must be rewritten.
    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    await flush();
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('1'), item('2')]);
  });
});

describe('clearScope purges an inactive scope behind its queued writes', () => {
  it('purges a row and index entry whose writes were still queued, and leaves the active scope alone', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    // The previous user's row write is still in flight when the purge starts.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { set } = storage.storage;
    storage.storage.set = async (key, row) => {
      if (key.scope === SCOPE && key.queryKey === 'a?{}') await held;
      return set(key, row);
    };
    engine.replace({ id: 'a' }, [item('deleted')]);

    // The account switches; the new user paints and persists its own row.
    scopeState.current = 'u2';
    engine.replace({ id: 'b' }, [item('active')]);
    await flush();

    const purging = engine.clearScope(SCOPE);
    release();
    await expect(purging).resolves.toBe(true);
    await flush();

    expect(storage.rows.has(`${SCOPE}|a?{}`)).toBe(false);
    expect(storage.index()).not.toContain('a?{}');
    // The active user's view and row are untouched.
    expect(host.view().b).toEqual([item('active')]);
    expect(storage.rows.get('u2|b?{}')?.data).toEqual([item('active')]);
    resetScope();
  });

  it('is clear() for the active scope', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();

    await expect(engine.clearScope(SCOPE)).resolves.toBe(true);

    expect(host.view()).toEqual({});
    expect(storage.dataKeys()).toEqual([]);
  });
});

describe('entity changes confirmed for a captured scope', () => {
  it('removeEntity({ scope }) patches only that scope’s rows, leaving the active view alone', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    await flush();

    // The account switches; the new one shows a list holding the same id.
    scopeState.current = 'u2';
    engine.replace({ id: 'b' }, [item('1')]);
    await flush();

    engine.removeEntity('1', { scope: SCOPE });
    await flush();

    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([item('2')]);
    // The active account's view and row are untouched.
    expect(host.view().b).toEqual([item('1')]);
    expect(storage.rows.get('u2|b?{}')?.data).toEqual([item('1')]);

    // Back on the first account, its list hydrates without the entity.
    scopeState.current = SCOPE;
    engine.ensureScope(SCOPE);
    await engine.hydrate({ id: 'a' });
    expect(host.view().a).toEqual([item('2')]);
    resetScope();
  });

  it('reconciles an entry hydrated while an off-scope update was still landing', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    await flush();
    scopeState.current = 'u2';
    engine.ensureScope('u2');

    // Hold the patch on its index read, so the switch back lands first.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { getStrict } = storage.storage;
    storage.storage.getStrict = async (key) => {
      if (key.scope === SCOPE && key.queryKey === REPLICA_INDEX_KEY) await held;
      return getStrict!(key);
    };
    engine.updateEntity<Item>('1', () => ({ id: '1', renamed: true }) as Item, { scope: SCOPE });

    // Back on the first account: its list hydrates the pre-patch row.
    scopeState.current = SCOPE;
    engine.ensureScope(SCOPE);
    await engine.hydrate({ id: 'a' });
    expect(host.view().a).toEqual([item('1'), item('2')]);

    release();
    await flush();
    await flush();

    // The patch landed in storage and in the view now on screen.
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([
      { id: '1', renamed: true },
      item('2'),
    ]);
    expect(host.view().a).toEqual([{ id: '1', renamed: true }, item('2')]);
    resetScope();
  });

  it('patches a captured scope’s rows whose writes were still queued at the switch', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    // Every write of the first account is still queued when the account switches.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { set } = storage.storage;
    storage.storage.set = async (key, row) => {
      if (key.scope === SCOPE) await held;
      return set(key, row);
    };
    engine.replace({ id: 'a' }, [item('1'), item('2')]);
    engine.replace({ id: 'b' }, [item('1')]);

    scopeState.current = 'u2';
    engine.ensureScope('u2');
    engine.replace({ id: 'c' }, [item('1')]);
    engine.removeEntity('1', { scope: SCOPE });
    engine.updateEntity<Item>('2', () => ({ id: '2', renamed: true }) as Item, { scope: SCOPE });

    release();
    for (let i = 0; i < 5; i++) await flush();

    // Neither row was in the persisted index yet, yet both got the change.
    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([{ id: '2', renamed: true }]);
    expect(storage.rows.get(`${SCOPE}|b?{}`)?.data).toEqual([]);
    // The active account is untouched.
    expect(host.view().c).toEqual([item('1')]);
    expect(storage.rows.get('u2|c?{}')?.data).toEqual([item('1')]);
    resetScope();
  });

  it('updateEntity({ scope }) patches only that scope’s rows', async () => {
    resetScope();
    const storage = createStorage();
    const { engine, host } = setupList(storage);
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    scopeState.current = 'u2';
    engine.replace({ id: 'b' }, [item('1')]);
    await flush();

    engine.updateEntity<Item>('1', () => ({ id: '1', renamed: true }) as Item, { scope: SCOPE });
    await flush();

    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toEqual([{ id: '1', renamed: true }]);
    expect(host.view().b).toEqual([item('1')]);
    expect(storage.rows.get('u2|b?{}')?.data).toEqual([item('1')]);
    resetScope();
  });
});

describe('bounded persisted entries (persist.maxEntries)', () => {
  const bounded = (storage = createStorage()) => ({
    storage,
    ...setupList(storage, { maxEntries: 2 }),
  });

  it('evicts the least recently used row, its index entry and its idle memory entry', async () => {
    resetScope();
    const { engine, host, storage } = bounded();
    engine.replace({ id: 'a' }, [item('1')]);
    engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    engine.replace({ id: 'c' }, [item('3')]);
    await flush();

    expect(storage.dataKeys()).toEqual(['b?{}', 'c?{}']);
    expect(storage.index()).toEqual(['b?{}', 'c?{}']);
    expect(Object.keys(host.view()).sort()).toEqual(['b', 'c']);
    expect(host.state().entries.a).toBeUndefined();
  });

  it('counts an unchanged revalidation and a hydrate as a use', async () => {
    resetScope();
    const { engine, storage } = bounded();
    engine.replace({ id: 'a' }, [item('1')]);
    engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    // `a` is revalidated with the same value: no row write, but it is now recent.
    engine.replace({ id: 'a' }, [item('1')]);
    await flush();
    engine.replace({ id: 'c' }, [item('3')]);
    await flush();
    expect(storage.dataKeys()).toEqual(['a?{}', 'c?{}']);

    // A later session hydrates `a`: `c` becomes the oldest.
    const next = bounded(storage);
    expect(await next.engine.hydrate({ id: 'a' })).toBe(true);
    await flush();
    next.engine.replace({ id: 'd' }, [item('4')]);
    await flush();
    expect(storage.dataKeys()).toEqual(['a?{}', 'd?{}']);
  });

  it('keeps recency across reloads through the persisted index', async () => {
    resetScope();
    const first = bounded();
    first.engine.replace({ id: 'a' }, [item('1')]);
    first.engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    first.engine.replace({ id: 'a' }, [item('1'), item('x')]);
    await flush();
    expect(first.storage.index()).toEqual(['b?{}', 'a?{}']);

    const { engine, storage } = bounded(first.storage);
    engine.replace({ id: 'c' }, [item('3')]);
    await flush();
    expect(storage.dataKeys()).toEqual(['a?{}', 'c?{}']);
  });

  it('never evicts a retained row or an entry with pending writes', async () => {
    resetScope();
    const { engine, host, storage } = bounded();
    engine.replace({ id: 'a' }, [item('1')]);
    engine.replace({ id: 'b' }, [item('2')]);
    await flush();
    const release = engine.retain('a', 'a?{}');
    const pending = engine.beginOptimistic('b', (data) => [...data, item('tmp')]);

    engine.replace({ id: 'c' }, [item('3')]);
    await flush();
    // Both older rows are pinned: the cap waits rather than dropping them.
    expect(storage.dataKeys()).toEqual(['a?{}', 'b?{}', 'c?{}']);
    expect(host.view().a).toEqual([item('1')]);

    pending.rollback();
    release();
    engine.replace({ id: 'd' }, [item('4')]);
    await flush();
    expect(storage.dataKeys()).toEqual(['c?{}', 'd?{}']);
    expect(Object.keys(host.view()).sort()).toEqual(['c', 'd']);
  });

  it('keeps a row whose eviction delete failed indexed, and retries it on the next use', async () => {
    resetScope();
    const { engine, storage } = bounded();
    storage.failRemoves.add('a?{}');
    engine.replace({ id: 'a' }, [item('1')]);
    engine.replace({ id: 'b' }, [item('2')]);
    engine.replace({ id: 'c' }, [item('3')]);
    await flush();
    // `a` was picked but its delete failed: it stays indexed and stored.
    expect(storage.index()).toEqual(['a?{}', 'b?{}', 'c?{}']);
    expect(storage.dataKeys()).toEqual(['a?{}', 'b?{}', 'c?{}']);

    storage.failRemoves.delete('a?{}');
    engine.replace({ id: 'c' }, [item('3'), item('4')]);
    await flush();
    expect(storage.index()).toEqual(['b?{}', 'c?{}']);
    expect(storage.dataKeys()).toEqual(['b?{}', 'c?{}']);
  });

  it('leaves an unbounded resource append-ordered and unevicted', async () => {
    resetScope();
    const storage = createStorage();
    const { engine } = setupList(storage);
    for (const id of ['a', 'b', 'c']) engine.replace({ id }, [item(id)]);
    await flush();
    engine.replace({ id: 'a' }, [item('a'), item('x')]);
    await flush();
    expect(storage.index()).toEqual(['a?{}', 'b?{}', 'c?{}']);
  });
});

describe('useSync pins the entry it shows', () => {
  it('a mounted useSync keeps its row and memory entry; unmounting releases them', async () => {
    resetScope();
    const storage = createStorage();
    const resource = defineReplica<ListParams, Item[]>({
      key: ({ id }) => id,
      name: 'list',
      persist: { maxEntries: 1 },
      query: ({ q }) => ({ q }),
      scope,
      storage: storage.storage,
      version: 1,
    });
    interface State {
      lists: Record<string, Item[]>;
      listsReplica: ReplicaState<Item[]>;
    }
    const store = createStore<State>()(() => ({ lists: {}, listsReplica: createReplicaState() }));
    const slice = createReplicaSlice<State, ListParams, Item[]>(resource, {
      driver: testDriver,
      // No fetcher: only the pin is under test.
      get: store.getState,
      set: (partial) => store.setState(partial),
      stateKey: 'listsReplica',
      view: recordLens('lists'),
    });

    const view = renderHook(() => slice.useSync({ id: 'a' }));
    slice.replace({ id: 'a' }, [item('1')]);
    slice.replace({ id: 'b' }, [item('2')]);
    await flush();
    await flush();
    expect(storage.dataKeys()).toEqual(['a?{}', 'b?{}']);
    expect(store.getState().lists.a).toEqual([item('1')]);

    view.unmount();
    slice.replace({ id: 'c' }, [item('3')]);
    await flush();
    await flush();
    expect(storage.dataKeys()).toEqual(['c?{}']);
    expect(Object.keys(store.getState().lists)).toEqual(['c']);
  });
});

describe('entity patches of unloaded rows', () => {
  it('writes a `null` the entity adapter maps to as a value, and drops the row only on `undefined`', async () => {
    resetScope();
    const storage = createStorage();
    const setup = () => {
      const resource = defineReplica<ListParams, Item[] | null>({
        key: ({ id }) => id,
        name: 'list',
        query: ({ q }) => ({ q }),
        scope,
        storage: storage.storage,
        version: 1,
      });
      const host = createHost<Item[] | null>();
      const engine = createReplicaEngine(resource, {
        // `null` is a real value of this resource: "cleared", not "gone".
        entity: {
          has: (data, id) => !!data?.some((entry) => entry.id === id),
          map: (data, id, fn) => {
            if (!data?.some((entry) => entry.id === id)) return data;
            const next = data.map((entry) => (entry.id === id ? fn(entry) : entry));
            if (next.includes(undefined)) return id === 'gone' ? undefined : null;
            return next as Item[];
          },
        },
        port: host.port,
      });
      return engine;
    };
    const first = setup();
    first.replace({ id: 'a' }, [item('cleared')]);
    first.replace({ id: 'b' }, [item('gone')]);
    await flush();

    // A fresh session holds neither entry in memory, so both go through storage.
    const engine = setup();
    await engine.removeEntity('cleared');
    await engine.removeEntity('gone');
    await flush();

    expect(storage.rows.get(`${SCOPE}|a?{}`)?.data).toBeNull();
    expect(storage.rows.has(`${SCOPE}|b?{}`)).toBe(false);
  });
});
