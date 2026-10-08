import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { definePagedReplica, defineReplica } from '../core/defineReplica';
import { linkReplicaEntity } from '../core/entity';
import { singleEntity } from '../core/entityAdapters';
import type { ReplicaPagedData, ReplicaPageResult } from '../core/paging';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from '../core/types';
import { createReplicaSlice, recordLens } from './createReplicaSlice';

interface Row {
  id: string;
  title: string;
}
interface Params {
  filter?: string;
  owner: string;
  pageSize: number;
}
type Paged = ReplicaPagedData<Row, number> & { filter?: string };

interface TestState {
  details: Record<string, Row>;
  detailsReplica: ReplicaState<Row>;
  lists: Record<string, Paged>;
  listsReplica: ReplicaState<Paged>;
}

const scopeState = { current: 'user-1' };
const scope: ReplicaScope = {
  canPersist: () => true,
  get: () => scopeState.current,
  use: () => scopeState.current,
};

const createMemoryStorage = <T>() => {
  const rows = new Map<string, ReplicaRow<T>>();
  const storage: ReplicaStorage<T> = {
    get: async ({ queryKey, scope }) => rows.get(`${scope}|${queryKey}`),
    remove: async ({ queryKey, scope }) => {
      rows.delete(`${scope}|${queryKey}`);
    },
    set: async ({ queryKey, scope }, projection) => {
      rows.set(`${scope}|${queryKey}`, projection);
    },
  };
  return { rows, storage };
};

const row = (id: string, title = id): Row => ({ id, title });
const ids = (data?: { items: Row[] }) => data?.items.map((item) => item.id);
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

/** Server with 2-row pages over `a..e` (or a filtered set). */
const pageOf = (params: Params, cursor = 0): ReplicaPageResult<Row, number> => {
  const all = (params.filter === 'odd' ? ['a', 'c', 'e'] : ['a', 'b', 'c', 'd', 'e']).map((id) =>
    row(id),
  );
  return {
    items: all.slice(cursor * params.pageSize, (cursor + 1) * params.pageSize),
    total: all.length,
  };
};

const setup = (
  fetchPage = vi.fn(async (params: Params, cursor?: number) => pageOf(params, cursor)),
  {
    detailStorage = createMemoryStorage<Row>(),
    listStorage = createMemoryStorage<Paged>(),
  }: {
    detailStorage?: ReturnType<typeof createMemoryStorage<Row>>;
    listStorage?: ReturnType<typeof createMemoryStorage<Paged>>;
  } = {},
) => {
  const listResource = definePagedReplica<Params, Row, number, Paged>({
    fetchPage,
    key: ({ owner }) => owner,
    name: 'pagedTest',
    paging: { direction: 'forward', getId: (item) => item.id, mode: 'offset' },
    query: ({ filter }) => ({ filter }),
    scope,
    storage: listStorage.storage,
    version: 1,
  });
  const detailResource = defineReplica<string, Row>({
    key: (id) => id,
    name: 'detailTest',
    scope,
    storage: detailStorage.storage,
    version: 1,
  });
  const store = createStore<TestState>()(() => ({
    details: {},
    detailsReplica: createReplicaState(),
    lists: {},
    listsReplica: createReplicaState(),
  }));
  const list = createReplicaSlice(listResource, {
    driver,
    get: store.getState,
    isClientOnly: (item: Row) => item.id.startsWith('tmp'),
    set: (partial) => store.setState(partial),
    stateKey: 'listsReplica',
    view: recordLens<TestState, Paged>('lists'),
    viewFields: ({ filter }) => ({ filter }),
  });
  const detail = createReplicaSlice(detailResource, {
    driver,
    entity: singleEntity<Row>((item) => item.id),
    get: store.getState,
    set: (partial) => store.setState(partial),
    stateKey: 'detailsReplica',
    view: recordLens<TestState, Row>('details'),
  });
  return { detail, detailStorage, fetchPage, list, listResource, listStorage, store };
};

const params: Params = { owner: 'o1', pageSize: 2 };

beforeEach(() => {
  scopeState.current = 'user-1';
});

describe('paged replica slice', () => {
  it('loadMore pages with the stored head params and dedupes by id', async () => {
    const { fetchPage, list, store } = setup();
    list.replace(params, pageOf(params));
    await list.loadMore('o1');
    expect(fetchPage).toHaveBeenLastCalledWith(params, 1);
    expect(ids(store.getState().lists.o1)).toEqual(['a', 'b', 'c', 'd']);
    expect(store.getState().lists.o1).toMatchObject({ currentPage: 1, hasMore: true });
  });

  it('drops a page that lands after the query changed', async () => {
    const pending = deferred<ReplicaPageResult<Row, number>>();
    const { list, store } = setup(
      vi.fn(async (p: Params, cursor?: number) => (cursor ? pending.promise : pageOf(p, cursor))),
    );
    list.replace(params, pageOf(params));
    const loading = list.loadMore('o1');
    expect(store.getState().lists.o1.isLoadingMore).toBe(true);

    const odd = { ...params, filter: 'odd' };
    list.replace(odd, pageOf(odd));
    // Head refresh while the page is in flight keeps the flag.
    expect(store.getState().lists.o1).toMatchObject({ filter: 'odd', isLoadingMore: true });

    pending.resolve(pageOf(params, 1));
    await loading;
    expect(ids(store.getState().lists.o1)).toEqual(['a', 'c']);
    expect(store.getState().lists.o1.isLoadingMore).toBe(false);
  });

  it('a head refresh with no page in flight clears a stale loading flag', () => {
    const { list, store } = setup();
    list.replace(params, pageOf(params));
    list.update('o1', (data) => data && { ...data, isLoadingMore: true }, { persist: false });
    list.replace(params, { items: [row('z'), row('a')], total: 6 });
    expect(store.getState().lists.o1.isLoadingMore).toBe(false);
  });

  it('a scope switch clears loaded pages and drops the late page', async () => {
    const pending = deferred<ReplicaPageResult<Row, number>>();
    const { list, store } = setup(
      vi.fn(async (p: Params, cursor?: number) => (cursor ? pending.promise : pageOf(p, cursor))),
    );
    list.replace(params, pageOf(params));
    const loading = list.loadMore('o1');

    scopeState.current = 'user-2';
    list.ensureScope('user-2');
    expect(store.getState().lists).toEqual({});

    pending.resolve(pageOf(params, 1));
    await loading;
    expect(store.getState().lists).toEqual({});
  });

  it('rolls back an optimistic patch without losing a page loaded meanwhile', async () => {
    const { list, store } = setup();
    list.replace(params, pageOf(params));
    const server = deferred<void>();

    const write = list
      .optimistic(
        'o1',
        (data) => ({ ...data, items: data.items.map((r) => (r.id === 'a' ? row('a', 'A!') : r)) }),
        () => server.promise,
      )
      .catch(() => undefined);
    expect(store.getState().lists.o1.items[0].title).toBe('A!');

    await list.loadMore('o1');
    expect(ids(store.getState().lists.o1)).toEqual(['a', 'b', 'c', 'd']);

    server.reject(new Error('nope'));
    await write;
    expect(store.getState().lists.o1.items[0].title).toBe('a');
    expect(ids(store.getState().lists.o1)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('persists the head page per query; another query never hydrates it', async () => {
    const { list, listResource, listStorage, store } = setup();
    list.replace(params, pageOf(params));
    await list.loadMore('o1');
    await vi.waitFor(() =>
      expect(listStorage.rows.get(`user-1|${listResource.storageKey(params)}`)).toBeDefined(),
    );
    const persisted = listStorage.rows.get(`user-1|${listResource.storageKey(params)}`)!;
    expect(ids(persisted.data)).toEqual(['a', 'b']);

    // Fresh store: the filtered query misses, the original query hydrates.
    const reloaded = setup();
    reloaded.listStorage.rows.set(`user-1|${listResource.storageKey(params)}`, persisted);
    expect(await reloaded.list.hydrate({ ...params, filter: 'odd' })).toBe(false);
    expect(await reloaded.list.hydrate(params)).toBe(true);
    expect(ids(reloaded.store.getState().lists.o1)).toEqual(['a', 'b']);
    expect(store).toBeDefined();
  });

  it('insertHead keeps client-only rows across refreshes but out of storage', async () => {
    const { list, listResource, listStorage, store } = setup();
    list.replace(params, pageOf(params));
    list.insertHead('o1', [row('tmp-1')]);
    list.replace(params, pageOf(params));
    expect(ids(store.getState().lists.o1)).toEqual(['tmp-1', 'a', 'b']);
    await vi.waitFor(() => {
      const persisted = listStorage.rows.get(`user-1|${listResource.storageKey(params)}`);
      expect(ids(persisted?.data)).toEqual(['a', 'b']);
    });
  });
});

describe('linkReplicaEntity', () => {
  const seeded = () => {
    const ctx = setup();
    ctx.list.replace(params, pageOf(params));
    ctx.list.replace({ owner: 'o2', pageSize: 2 }, { items: [row('a'), row('x')], total: 2 });
    ctx.detail.replace('a', row('a'));
    const topic = linkReplicaEntity<Row>([ctx.list, ctx.detail]);
    return { ...ctx, topic };
  };

  it('propagates a patch to every resource and key holding the entity', () => {
    const { store, topic } = seeded();
    topic.update('a', (r) => ({ ...r, title: 'renamed' }));
    const state = store.getState();
    expect(state.lists.o1.items[0].title).toBe('renamed');
    expect(state.lists.o2.items[0].title).toBe('renamed');
    expect(state.details.a.title).toBe('renamed');
    expect(state.lists.o1.items[1].title).toBe('b');
  });

  it('removes the entity everywhere and fixes list totals', () => {
    const { store, topic } = seeded();
    topic.remove('a');
    const state = store.getState();
    expect(ids(state.lists.o1)).toEqual(['b']);
    expect(state.lists.o1.total).toBe(4);
    expect(state.details.a).toBeUndefined();
  });

  it('an optimistic write commits or rolls back across all resources together', async () => {
    const { store, topic } = seeded();
    const rename = (r: Row) => ({ ...r, title: 'opt' });

    await expect(
      topic.optimistic('a', rename, async () => {
        expect(store.getState().details.a.title).toBe('opt');
        expect(store.getState().lists.o2.items[0].title).toBe('opt');
        throw new Error('server down');
      }),
    ).rejects.toThrow('server down');
    expect(store.getState().details.a.title).toBe('a');
    expect(store.getState().lists.o1.items[0].title).toBe('a');

    await topic.optimistic('a', rename, async () => 'ok');
    expect(store.getState().details.a.title).toBe('opt');
    expect(store.getState().listsReplica.entries.o1.pending).toHaveLength(0);
  });

  it('an optimistic delete hides list rows at once and drops the detail on commit', async () => {
    const { store, topic } = seeded();
    const server = deferred<void>();
    const removal = topic.optimistic('a', 'remove', () => server.promise);
    expect(ids(store.getState().lists.o1)).toEqual(['b']);
    expect(store.getState().details.a).toBeDefined();
    server.resolve();
    await removal;
    expect(store.getState().details.a).toBeUndefined();
    expect(ids(store.getState().lists.o2)).toEqual(['x']);
  });
});

describe('entity changes for entries that are not loaded', () => {
  /** Session 1 persists `o1` (list) and `a` (detail); session 2 starts with empty memory. */
  const persistedThenReloaded = async () => {
    const first = setup();
    first.list.replace(params, pageOf(params));
    first.detail.replace('a', row('a'));
    const listKey = `user-1|${first.listResource.storageKey(params)}`;
    await vi.waitFor(() => {
      expect(first.listStorage.rows.get(listKey)).toBeDefined();
      expect(first.detailStorage.rows.get('user-1|a')).toBeDefined();
    });
    const second = setup(undefined, {
      detailStorage: first.detailStorage,
      listStorage: first.listStorage,
    });
    const topic = linkReplicaEntity<Row>([second.list, second.detail]);
    return { ...second, listKey, topic };
  };

  it('patches persisted rows of unloaded entries', async () => {
    const { detailStorage, listKey, listStorage, store, topic } = await persistedThenReloaded();
    topic.update('a', (r) => ({ ...r, title: 'done' }));
    expect(store.getState().lists).toEqual({});
    await vi.waitFor(() => {
      expect(listStorage.rows.get(listKey)?.data.items[0].title).toBe('done');
      expect(detailStorage.rows.get('user-1|a')?.data.title).toBe('done');
    });
    expect(listStorage.rows.get(listKey)?.data.items[1].title).toBe('b');
  });

  it('removes the entity from unloaded persisted rows and never resurrects them', async () => {
    const { detailStorage, listKey, listStorage, topic } = await persistedThenReloaded();
    topic.remove('a');
    await vi.waitFor(() => {
      expect(ids(listStorage.rows.get(listKey)?.data)).toEqual(['b']);
      expect(detailStorage.rows.has('user-1|a')).toBe(false);
    });
    expect(listStorage.rows.get(listKey)?.data.total).toBe(4);

    // A later patch of the removed entity must not recreate its detail row.
    topic.update('a', (r) => ({ ...r, title: 'ghost' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(detailStorage.rows.has('user-1|a')).toBe(false);
  });

  it('a committed optimistic write also reaches unloaded rows', async () => {
    const { listKey, listStorage, topic } = await persistedThenReloaded();
    await topic.optimistic(
      'a',
      (r) => ({ ...r, title: 'opt' }),
      async () => 'ok',
    );
    await vi.waitFor(() => expect(listStorage.rows.get(listKey)?.data.items[0].title).toBe('opt'));
  });

  it('never touches rows of another scope', async () => {
    const { listKey, listStorage, topic } = await persistedThenReloaded();
    scopeState.current = 'user-2';
    topic.update('a', (r) => ({ ...r, title: 'other-user' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listStorage.rows.get(listKey)?.data.items[0].title).toBe('a');
  });
});
