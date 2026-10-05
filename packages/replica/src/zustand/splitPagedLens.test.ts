import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { definePagedReplica } from '../core/defineReplica';
import type { ReplicaPagedData } from '../core/paging';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from '../core/types';
import { createReplicaSlice, splitPagedLens } from './createReplicaSlice';

/**
 * A transcript-shaped host: raw rows in `rowsMap` (what existing readers use),
 * paging bookkeeping beside them, and a display list derived from the rows.
 */
interface Message {
  createdAt: number;
  id: string;
}
interface TestState {
  displayMap: Record<string, string[]>;
  pagingMap: Record<string, Omit<ReplicaPagedData<Message, number>, 'items'>>;
  replica: ReplicaState<ReplicaPagedData<Message, number>>;
  rowsMap: Record<string, Message[]>;
}

const scope: ReplicaScope = { canPersist: () => true, get: () => 'u1', use: () => 'u1' };

const memoryStorage = () => {
  const rows = new Map<string, ReplicaRow<any>>();
  const storage: ReplicaStorage<any> = {
    get: async ({ queryKey, scope }) => rows.get(`${scope}|${queryKey}`),
    remove: async ({ queryKey, scope }) => void rows.delete(`${scope}|${queryKey}`),
    set: async ({ queryKey, scope }, row) => void rows.set(`${scope}|${queryKey}`, row),
  };
  return { rows, storage };
};

const msg = (n: number): Message => ({ createdAt: n, id: `m${n}` });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
  const { rows, storage } = memoryStorage();
  const resource = definePagedReplica<{ topic: string }, Message, number>({
    key: ({ topic }) => topic,
    name: 'transcript',
    paging: { direction: 'backward', getId: (m) => m.id, mode: 'cursor' },
    // Scoped buckets (e.g. a page copilot) stay in memory.
    persistKey: (key) => !key.startsWith('scoped:'),
    scope,
    storage,
    version: 1,
  });
  const store = createStore<TestState>()(() => ({
    displayMap: {},
    pagingMap: {},
    replica: createReplicaState(),
    rowsMap: {},
  }));
  const slice = createReplicaSlice(resource, {
    driver,
    get: store.getState,
    set: (partial) => store.setState(partial),
    stateKey: 'replica',
    view: splitPagedLens<TestState, Message, number>({
      clearDerived: () => ({ displayMap: {} }),
      derive: (state, key, items) => {
        const displayMap = { ...state.displayMap };
        if (items) displayMap[key] = items.map((m) => m.id.toUpperCase());
        else delete displayMap[key];
        return { displayMap };
      },
      itemsField: 'rowsMap',
      metaField: 'pagingMap',
    }),
  });
  return { rows, slice, store };
};

describe('splitPagedLens', () => {
  it('keeps raw rows, bookkeeping and the derived list in step', () => {
    const { slice, store } = setup();

    slice.replace({ topic: 't1' }, { items: [msg(1), msg(2)], nextCursor: 1 });

    const state = store.getState();
    expect(state.rowsMap.t1.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(state.pagingMap.t1).toMatchObject({ currentPage: 0, nextCursor: 1 });
    expect(state.displayMap.t1).toEqual(['M1', 'M2']);
  });

  it('reads an unchanged entry as the same view object', () => {
    const { slice, store } = setup();
    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });
    const before = store.getState().rowsMap;

    // Folding the identical page in again is a no-op for readers.
    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });
    slice.update('t1', (data) => data);

    expect(store.getState().rowsMap).toBe(before);
  });

  it('treats rows seeded without bookkeeping as a head page', () => {
    const { slice, store } = setup();
    store.setState({ rowsMap: { t1: [msg(1)] } });

    slice.updateEntity<Message>('m1', (m) => ({ ...m, createdAt: 9 }), { persist: false });

    expect(store.getState().rowsMap.t1[0].createdAt).toBe(9);
    expect(store.getState().displayMap.t1).toEqual(['M1']);
  });

  it('drops derived fields with the entry', () => {
    const { slice, store } = setup();
    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });

    slice.remove('t1');
    expect(store.getState().displayMap.t1).toBeUndefined();
    expect(store.getState().rowsMap.t1).toBeUndefined();
  });
});

describe('prepareHead', () => {
  it('reconciles a head page with the shown rows, or drops it', () => {
    const resource = definePagedReplica<{ topic: string }, Message, number>({
      key: ({ topic }) => topic,
      name: 'preparedTranscript',
      paging: { direction: 'backward', getId: (m) => m.id, mode: 'cursor' },
      scope,
      version: 1,
    });
    const store = createStore<TestState>()(() => ({
      displayMap: {},
      pagingMap: {},
      replica: createReplicaState(),
      rowsMap: {},
    }));
    let dropNext = false;
    const slice = createReplicaSlice(resource, {
      driver,
      get: store.getState,
      // Keep a locally newer row (higher createdAt) over the server's copy.
      prepareHead: (page, current) => {
        if (dropNext) return undefined;
        const local = new Map(current?.items.map((m) => [m.id, m]));
        return {
          ...page,
          items: page.items.map((m) => {
            const mine = local.get(m.id);
            return mine && mine.createdAt > m.createdAt ? mine : m;
          }),
        };
      },
      set: (partial) => store.setState(partial),
      stateKey: 'replica',
      view: splitPagedLens<TestState, Message, number>({
        itemsField: 'rowsMap',
        metaField: 'pagingMap',
      }),
    });

    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });
    slice.update('t1', (data) => data && { ...data, items: [{ createdAt: 9, id: 'm1' }] });
    slice.replace({ topic: 't1' }, { items: [msg(1), msg(2)], nextCursor: null });
    expect(store.getState().rowsMap.t1).toEqual([{ createdAt: 9, id: 'm1' }, msg(2)]);

    dropNext = true;
    expect(slice.replace({ topic: 't1' }, { items: [], nextCursor: null })).toBe(false);
    expect(store.getState().rowsMap.t1).toHaveLength(2);
  });
});

describe('persistKey and persist()', () => {
  it('never persists or hydrates a key the resource keeps in memory', async () => {
    const { rows, slice } = setup();

    slice.replace({ topic: 'scoped:page-1' }, { items: [msg(1)], nextCursor: null });
    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });
    await flush();

    expect(rows.has('u1|scoped:page-1')).toBe(false);
    expect(rows.has('u1|t1')).toBe(true);
    expect(await slice.hydrate({ topic: 'scoped:page-1' })).toBe(false);
  });

  it('flushes in-memory writes (a finished stream) in one persist', async () => {
    const { rows, slice } = setup();
    slice.replace({ topic: 't1' }, { items: [msg(1)], nextCursor: null });
    await flush();

    for (const n of [2, 3, 4]) slice.insertHead('t1', [msg(n)]);
    await flush();
    expect(rows.get('u1|t1')?.data.items).toHaveLength(1);

    slice.persist('t1');
    await flush();
    expect(rows.get('u1|t1')?.data.items.map((m: Message) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
  });
});
