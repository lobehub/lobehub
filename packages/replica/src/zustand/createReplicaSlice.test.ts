/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { REPLICA_INDEX_KEY } from '../core/engine';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from '../core/types';
import { createReplicaSlice, recordLens } from './createReplicaSlice';

interface TestState {
  lists: Record<string, string[]>;
  listsReplica: ReplicaState<string[]>;
}

const scopeState = { current: 'user-1:personal', trusted: true };
const scope: ReplicaScope = {
  canPersist: () => scopeState.trusted,
  get: () => scopeState.current,
  // The real `use` is `useCacheScope`; a plain getter is enough for these tests.
  use: () => scopeState.current,
};

/** In-memory storage that records every write, keyed like the real ones. */
const createMemoryStorage = (delays: Record<string, number> = {}) => {
  const rows = new Map<string, ReplicaRow<string[]>>();
  const writes: string[] = [];
  const indexRows = new Map<string, ReplicaRow<string[]>>();
  const storage: ReplicaStorage<string[]> = {
    get: async ({ queryKey, scope }) =>
      queryKey === REPLICA_INDEX_KEY
        ? (indexRows.get(scope) as ReplicaRow<string[]> | undefined)
        : rows.get(`${scope}|${queryKey}`),
    remove: async ({ queryKey, scope }) => {
      rows.delete(`${scope}|${queryKey}`);
    },
    set: async ({ queryKey, scope }, projection) => {
      // The per-scope index of persisted rows is bookkeeping, not a data write.
      if (queryKey === REPLICA_INDEX_KEY) return void indexRows.set(scope, projection);
      const delay = delays[projection.data.join(',')] ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      writes.push(projection.data.join(','));
      rows.set(`${scope}|${queryKey}`, projection);
    },
  };
  return { indexRows, rows, storage, writes };
};

const setup = ({
  fetcher = vi.fn(async (_params: { id: string }) => ['server']),
  storage = createMemoryStorage(),
  version = 1,
}: {
  fetcher?: (params: { id: string }) => Promise<string[]>;
  storage?: ReturnType<typeof createMemoryStorage>;
  version?: number;
} = {}) => {
  const resource = defineReplica<{ id: string }, string[]>({
    fetcher,
    key: ({ id }) => id,
    name: 'testList',
    scope,
    storage: storage.storage,
    version,
  });
  const store = createStore<TestState>()(() => ({
    lists: {},
    listsReplica: createReplicaState(),
  }));
  const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
    driver,
    get: store.getState,
    set: (partial) => store.setState(partial),
    stateKey: 'listsReplica',
    view: recordLens('lists'),
  });
  return { fetcher, resource, slice, storage, store };
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

beforeEach(() => {
  scopeState.current = 'user-1:personal';
  scopeState.trusted = true;
});

describe('createReplicaSlice', () => {
  describe('useSync', () => {
    it('paints the persisted projection while the network request is in flight', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });
      let resolveFetch!: (value: string[]) => void;
      const fetcher = vi.fn(() => new Promise<string[]>((resolve) => (resolveFetch = resolve)));
      const { slice, store } = setup({ fetcher, storage });

      const { result } = renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

      await waitFor(() => expect(store.getState().lists.a).toEqual(['cached']));
      // Background loading never hides the hydrated data.
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isValidating).toBe(true);

      await act(async () => resolveFetch(['server']));

      await waitFor(() => expect(store.getState().lists.a).toEqual(['server']));
      expect(store.getState().listsReplica.entries.a.source).toBe('server');
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['server']));
    });

    it('runs onSuccess after the response is folded in, and onError on a failed fetch', async () => {
      const { slice, store } = setup();
      const seen: unknown[] = [];
      renderHook(
        () =>
          slice.useSync(
            { id: 'a' },
            { onSuccess: (data) => seen.push([data, store.getState().lists.a]) },
          ),
        { wrapper },
      );
      // The callback already sees the store view the response produced.
      await waitFor(() => expect(seen).toEqual([[['server'], ['server']]]));

      const failure = new Error('offline');
      const onError = vi.fn();
      const failing = setup({
        fetcher: vi.fn(async () => {
          throw failure;
        }),
      });
      renderHook(() => failing.slice.useSync({ id: 'b' }, { onError }), { wrapper });
      await waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
      expect(failing.store.getState().lists.b).toBeUndefined();
    });

    it('drops the prior persisted projection when `toPersisted` reports a confirmed absence', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });
      const resource = defineReplica<{ id: string }, string[]>({
        // The server confirms the id no longer exists.
        fetcher: vi.fn(async () => []),
        key: ({ id }) => id,
        name: 'absentList',
        scope,
        storage: storage.storage,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver,
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        // An empty list is a confirmed absence: drop the stored row instead of
        // leaving the stale projection to be hydrated again.
        toPersisted: (data) => (data.length ? data : null),
        view: recordLens('lists'),
      });

      renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

      // The confirmed absence replaces the hydrated value in the view…
      await waitFor(() => expect(store.getState().lists.a).toEqual([]));
      // …and the stale persisted projection is gone, so a reload cannot paint it.
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
    });

    it('keeps the stored row when `toPersisted` returns undefined (skip)', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: vi.fn(async () => ['server']),
        key: ({ id }) => id,
        name: 'skippedList',
        scope,
        storage: storage.storage,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver,
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        // `undefined` means "skip this write", not "remove".
        toPersisted: () => undefined,
        view: recordLens('lists'),
      });

      renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

      await waitFor(() => expect(store.getState().lists.a).toEqual(['server']));
      expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['cached']);
    });

    it('hands its schedule (polling, focus revalidation …) to the driver', () => {
      const useQuery = vi.fn(() => ({ isValidating: false, mutate: vi.fn() }));
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'scheduled',
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      renderHook(() =>
        slice.useSync({ id: 'a' }, { refreshInterval: 10_000, revalidateOnFocus: false }),
      );

      expect(useQuery).toHaveBeenCalledWith(
        expect.arrayContaining(['replica:sync', 'scheduled']),
        expect.any(Function),
        expect.objectContaining({ refreshInterval: 10_000, revalidateOnFocus: false }),
      );
    });

    it('discards a head response from a query the entry has moved past', () => {
      // A driver that settles every request through its own callback lets two
      // queries of the same key resolve out of order. One entry backs one view,
      // so the query the entry no longer asks for must not repaint it.
      const requests: {
        onSuccess: (data: string[]) => void;
        params: { q?: string };
      }[] = [];
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        if (key !== null) requests.push({ onSuccess: options.onSuccess, params: key.at(-1) });
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ q?: string }, string[]>({
        fetcher: async () => ['server'],
        key: () => 'all',
        name: 'orderedHead',
        query: ({ q }) => ({ q }),
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { q?: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      const { rerender } = renderHook((props: { q?: string }) => slice.useSync(props), {
        initialProps: {} as { q?: string },
      });
      rerender({ q: 'b' });

      const base = requests.find((request) => request.params.q === undefined)!;
      const search = requests.find((request) => request.params.q === 'b')!;

      act(() => search.onSuccess(['b-1']));
      expect(store.getState().lists.all).toEqual(['b-1']);

      // The superseded query settles late: it must not overwrite the search.
      act(() => base.onSuccess(['a-1']));
      expect(store.getState().lists.all).toEqual(['b-1']);
    });

    it('syncs under a custom key when the resource adopts one', () => {
      const useQuery = vi.fn(() => ({ isValidating: false, mutate: vi.fn() }));
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'customKeyed',
        scope,
        syncKey: ({ id }) => ['legacy:list', id],
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      renderHook(() => slice.useSync({ id: 'a' }));

      expect(useQuery).toHaveBeenCalledWith(
        ['legacy:list', 'a'],
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('does not let a slow hydration overwrite a faster server response', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });
      const originalGet = storage.storage.get;
      storage.storage.get = async (key) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return originalGet(key);
      };
      const { slice, store } = setup({ storage });

      const { result } = renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      expect(store.getState().lists.a).toEqual(['server']);
    });

    it('a version bump ignores rows written by the previous version', async () => {
      // One backing map shared by every version, keyed by the namespace the
      // factory receives — like IndexedDB rows of two app releases.
      const backing = new Map<string, ReplicaRow<string[]>>();
      const namespaced = (namespace: string): ReplicaStorage<string[]> => ({
        get: async ({ queryKey, scope }) => backing.get(`${namespace}|${scope}|${queryKey}`),
        remove: async ({ queryKey, scope }) => {
          backing.delete(`${namespace}|${scope}|${queryKey}`);
        },
        set: async ({ queryKey, scope }, row) => {
          backing.set(`${namespace}|${scope}|${queryKey}`, row);
        },
      });
      const bind = (version: number) => {
        const resource = defineReplica<{ id: string }, string[]>({
          key: ({ id }) => id,
          name: 'versionedList',
          scope,
          storage: namespaced,
          version,
        });
        const store = createStore<TestState>()(() => ({
          lists: {},
          listsReplica: createReplicaState(),
        }));
        const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
          driver,
          get: store.getState,
          set: (partial) => store.setState(partial),
          stateKey: 'listsReplica',
          view: recordLens('lists'),
        });
        return { slice, store };
      };

      const v1 = bind(1);
      act(() => {
        v1.slice.replace({ id: 'a' }, ['v1-shape']);
      });
      const dataKeys = () => [...backing.keys()].filter((key) => !key.includes(REPLICA_INDEX_KEY));
      await waitFor(() => expect(dataKeys()).toHaveLength(1));

      const v1Reload = bind(1);
      await act(async () => {
        await v1Reload.slice.hydrate({ id: 'a' });
      });
      expect(v1Reload.store.getState().lists.a).toEqual(['v1-shape']);

      const v2 = bind(2);
      await act(async () => {
        await v2.slice.hydrate({ id: 'a' });
      });
      expect(v2.store.getState().lists.a).toBeUndefined();
    });
  });

  describe('persisted index', () => {
    it('removes a key this instance never wrote from the stored index', async () => {
      const storage = createMemoryStorage();
      // An earlier session persisted this row and listed it in the index. This
      // instance has no memory of the key — the eviction / invalidation case
      // where the index write must still reach storage.
      storage.rows.set('user-1:personal|a', { data: ['stale'], updatedAt: 1 });
      storage.indexRows.set('user-1:personal', { data: ['a'], updatedAt: 1 });
      const { slice } = setup({ storage });

      act(() => slice.remove('a'));

      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
      await waitFor(() => expect(storage.indexRows.get('user-1:personal')?.data).toEqual([]));
    });
  });

  describe('scope isolation', () => {
    it('clears the previous identity and drops its late results', async () => {
      const { slice, store, storage } = setup();
      act(() => {
        slice.replace({ id: 'a' }, ['user-1-data']);
      });
      expect(store.getState().lists.a).toEqual(['user-1-data']);

      scopeState.current = 'user-2:personal';
      // A response that was in flight for user 1 lands after the switch.
      act(() => {
        slice.replace({ id: 'a' }, ['late-user-1'], 'user-1:personal');
      });
      expect(store.getState().lists.a).toEqual(['user-1-data']);

      // The first action under the new identity resets memory.
      act(() => {
        slice.replace({ id: 'b' }, ['user-2-data']);
      });
      expect(store.getState().lists).toEqual({ b: ['user-2-data'] });
      expect(store.getState().listsReplica.scope).toBe('user-2:personal');

      await waitFor(() => expect(storage.rows.size).toBe(2));
      expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['user-1-data']);
      expect(storage.rows.get('user-2:personal|b')?.data).toEqual(['user-2-data']);
    });

    it('useSync clears the previous identity even when the new scope has nothing to hydrate', async () => {
      const fetcher = vi.fn(() => new Promise<string[]>(() => {}));
      const { slice, store } = setup({ fetcher });
      act(() => {
        slice.replace({ id: 'a' }, ['user-1-data']);
      });

      scopeState.current = 'user-2:personal';
      const { result } = renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

      await waitFor(() => expect(result.current.isHydrated).toBe(true));
      expect(store.getState().lists).toEqual({});
      expect(store.getState().listsReplica.scope).toBe('user-2:personal');
    });

    it('hydrates only the active scope partition', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-2:personal|a', { data: ['someone-else'], updatedAt: 1 });
      const { slice, store } = setup({ storage });

      await act(async () => {
        await slice.hydrate({ id: 'a' });
      });

      expect(store.getState().lists.a).toBeUndefined();
    });

    it('never persists while the scope is untrusted', async () => {
      scopeState.trusted = false;
      const { slice, storage } = setup();
      act(() => {
        slice.replace({ id: 'a' }, ['server']);
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.writes).toEqual([]);
    });
  });

  describe('optimistic', () => {
    it('commits and persists the confirmed value on success', async () => {
      const { slice, store, storage } = setup();
      act(() => {
        slice.replace({ id: 'a' }, ['x']);
      });

      let resolveCall!: () => void;
      let promise!: Promise<unknown>;
      act(() => {
        promise = slice.optimistic(
          'a',
          (list) => [...list, 'y'],
          () => new Promise<void>((resolve) => (resolveCall = resolve)),
        );
      });
      expect(store.getState().lists.a).toEqual(['x', 'y']);

      await act(async () => {
        resolveCall();
        await promise;
      });
      expect(store.getState().lists.a).toEqual(['x', 'y']);
      await waitFor(() => expect(storage.writes.at(-1)).toBe('x,y'));
    });

    it('rolls back and rethrows on failure', async () => {
      const { slice, store, storage } = setup();
      act(() => {
        slice.replace({ id: 'a' }, ['x']);
      });
      await waitFor(() => expect(storage.writes).toEqual(['x']));

      await act(async () => {
        await expect(
          slice.optimistic(
            'a',
            (list) => [...list, 'y'],
            async () => {
              throw new Error('boom');
            },
          ),
        ).rejects.toThrow('boom');
      });

      expect(store.getState().lists.a).toEqual(['x']);
      expect(storage.writes).toEqual(['x']);
    });
  });

  describe('write ordering', () => {
    it('serializes persistence per key so the latest snapshot wins', async () => {
      // The first write is slow; without serialization it would land last.
      const storage = createMemoryStorage({ first: 30 });
      const { slice } = setup({ storage });

      act(() => {
        slice.replace({ id: 'a' }, ['first']);
        slice.replace({ id: 'a' }, ['second']);
      });

      await waitFor(() => expect(storage.writes).toEqual(['first', 'second']));
      expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['second']);
    });
  });
});
