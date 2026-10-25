/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { REPLICA_INDEX_KEY } from '../core/engine';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaStorage } from '../core/types';
import { createReplicaSlice, recordLens } from './createReplicaSlice';
import type { TestState } from './testUtils';
import { createMemoryStorage, resetScopeState, scope, scopeState, setup, wrapper } from './testUtils';

beforeEach(resetScopeState);

describe('createReplicaSlice', () => {
  describe('remove', () => {
    it('does not let an in-flight response resurrect a removed entry', async () => {
      let resolveFetch!: (value: string[]) => void;
      const fetcher = vi.fn(() => new Promise<string[]>((resolve) => (resolveFetch = resolve)));
      const { slice, store } = setup({ fetcher });

      renderHook(() => slice.useSync({ id: 'a' }), { wrapper });
      await waitFor(() => expect(fetcher).toHaveBeenCalled());

      // The entry is invalidated while its own request is still in flight.
      act(() => {
        slice.remove('a');
      });
      await act(async () => resolveFetch(['late']));

      expect(store.getState().lists.a).toBeUndefined();
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

  describe('invalidation', () => {
    interface QueryParams {
      id: string;
      q?: string;
    }
    /** A resource whose rows are persisted per query (`a`, `a?{"q":"x"}` …). */
    const setupQueried = ({
      driver: queryDriver = driver,
      storage = createMemoryStorage(),
    }: {
      driver?: Parameters<typeof createReplicaSlice>[1]['driver'];
      storage?: ReturnType<typeof createMemoryStorage>;
    } = {}) => {
      const resource = defineReplica<QueryParams, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'queriedList',
        query: ({ q }) => ({ q }),
        scope,
        storage: storage.storage,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, QueryParams, string[]>(resource, {
        driver: queryDriver,
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });
      return { resource, slice, storage, store };
    };
    const row = (resource: { storageKey: (params: QueryParams) => string }, params: QueryParams) =>
      `user-1:personal|${resource.storageKey(params)}`;

    /** Persist `a` (unfiltered + filtered) and `ab` in one session. */
    const persistVariants = async () => {
      const first = setupQueried();
      act(() => {
        first.slice.replace({ id: 'a' }, ['a-all']);
        first.slice.replace({ id: 'a', q: 'x' }, ['a-x']);
        first.slice.replace({ id: 'ab' }, ['ab-all']);
      });
      await waitFor(() => expect(first.storage.rows.size).toBe(3));
      return first;
    };

    it('remove drops every persisted query variant of the key, not only the one in memory', async () => {
      const { resource, slice, storage } = await persistVariants();

      // Memory holds the filtered query; the unfiltered row was persisted earlier.
      act(() => slice.remove('a'));

      await waitFor(() => {
        expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(false);
        expect(storage.rows.has(row(resource, { id: 'a', q: 'x' }))).toBe(false);
      });
      // Another key that merely shares the prefix is untouched.
      expect(storage.rows.get(row(resource, { id: 'ab' }))?.data).toEqual(['ab-all']);
    });

    it('remove drops variants persisted by an earlier session, through the index', async () => {
      const first = await persistVariants();
      // Reload: memory is empty, only the persisted index knows the variants.
      const { resource, slice, storage, store } = setupQueried({ storage: first.storage });

      act(() => slice.remove('a'));

      await waitFor(() => {
        expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(false);
        expect(storage.rows.has(row(resource, { id: 'a', q: 'x' }))).toBe(false);
      });
      // No variant of the removed key hydrates.
      await act(async () => {
        expect(await slice.hydrate({ id: 'a', q: 'x' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });

    it('an off-scope purge drops every query variant of its scope', async () => {
      const { resource, slice, storage } = await persistVariants();

      scopeState.current = 'user-2:personal';
      act(() => slice.remove('a', 'user-1:personal'));

      await waitFor(() => {
        expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(false);
        expect(storage.rows.has(row(resource, { id: 'a', q: 'x' }))).toBe(false);
      });
    });

    /** Make storage reject the first delete of `queryKey` (a closed IndexedDB). */
    const failFirstDelete = (storage: ReturnType<typeof createMemoryStorage>, queryKey: string) => {
      const original = storage.storage.remove;
      let failed = false;
      storage.storage.remove = async (key) => {
        if (key.queryKey === queryKey && !failed) {
          failed = true;
          throw new Error('IndexedDB delete failed');
        }
        return original(key);
      };
    };

    it('keeps a variant whose delete failed indexed, so a later remove retries it', async () => {
      const { resource, slice, storage } = await persistVariants();
      const filtered = row(resource, { id: 'a', q: 'x' });
      failFirstDelete(storage, resource.storageKey({ id: 'a', q: 'x' }));
      // Memory holds another variant, so the failing row is found through the index.
      act(() => slice.replace({ id: 'a' }, ['a-all']));

      act(() => slice.remove('a'));
      await waitFor(() => expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(false));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.rows.has(filtered)).toBe(true);

      // The next removal still knows about the failed row and retries it.
      act(() => slice.remove('a'));
      await waitFor(() => expect(storage.rows.has(filtered)).toBe(false));
    });

    it('keeps a row whose delete failed indexed, so a later clear retries it', async () => {
      const { resource, slice, storage } = await persistVariants();
      failFirstDelete(storage, resource.storageKey({ id: 'ab' }));

      let purge!: Promise<boolean>;
      act(() => {
        purge = slice.clear();
      });
      expect(await purge).toBe(false);
      expect([...storage.rows.keys()]).toEqual([row(resource, { id: 'ab' })]);

      act(() => {
        purge = slice.clear();
      });
      expect(await purge).toBe(true);
      expect(storage.rows.size).toBe(0);
    });

    /**
     * Storage whose index read fails the way the app adapters do: `get`
     * swallows it into a miss, only `getStrict` reports it.
     */
    const failIndexReads = (storage: ReturnType<typeof createMemoryStorage>) => {
      const state = { failing: true };
      const original = storage.storage.get;
      storage.storage.get = async (key) =>
        key.queryKey === REPLICA_INDEX_KEY && state.failing ? undefined : original(key);
      storage.storage.getStrict = async (key) => {
        if (key.queryKey === REPLICA_INDEX_KEY && state.failing)
          throw new Error('IndexedDB read failed');
        return original(key);
      };
      return state;
    };

    it('reports a clear as failed when the index cannot be read, and a later clear retries', async () => {
      const first = await persistVariants();
      // Reload: only the persisted index knows the earlier session's rows.
      const { slice, storage, store } = setupQueried({ storage: first.storage });
      const index = failIndexReads(storage);

      let purge!: Promise<boolean>;
      act(() => {
        purge = slice.clear();
      });
      expect(await purge).toBe(false);
      expect(storage.rows.size).toBe(3);
      // Hydration stays off while the wipe is incomplete.
      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();

      index.failing = false;
      act(() => {
        purge = slice.clear();
      });
      expect(await purge).toBe(true);
      expect(storage.rows.size).toBe(0);
    });

    it('keeps a removal unpurged when the index cannot be read, so it retries', async () => {
      const first = await persistVariants();
      const { resource, slice, storage } = setupQueried({ storage: first.storage });
      const filtered = row(resource, { id: 'a', q: 'x' });
      const index = failIndexReads(storage);

      // Memory is empty, so every variant is known only through the index.
      act(() => slice.remove('a'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(true);
      expect(storage.rows.has(filtered)).toBe(true);

      index.failing = false;
      act(() => slice.remove('a'));
      await waitFor(() => {
        expect(storage.rows.has(row(resource, { id: 'a' }))).toBe(false);
        expect(storage.rows.has(filtered)).toBe(false);
      });
    });

    it('never mistakes a plain key containing `?` for a query variant', async () => {
      const storage = createMemoryStorage();
      const { slice } = setup({ storage });
      act(() => {
        slice.replace({ id: 'foo' }, ['foo']);
        slice.replace({ id: 'foo?bar' }, ['foo?bar']);
      });
      await waitFor(() => expect(storage.rows.size).toBe(2));

      act(() => slice.remove('foo'));

      await waitFor(() => expect(storage.rows.has('user-1:personal|foo')).toBe(false));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.rows.get('user-1:personal|foo?bar')?.data).toEqual(['foo?bar']);
    });

    it('cleans variants listed by an index written in the existing flat format', async () => {
      const storage = createMemoryStorage();
      // Rows and index as an earlier release persisted them on a device.
      for (const queryKey of ['foo?{}', 'foo?{"q":"x"}', 'foo?bar?{}'])
        storage.rows.set(`user-1:personal|${queryKey}`, { data: [queryKey], updatedAt: 1 });
      storage.indexRows.set('user-1:personal', {
        data: ['foo?{}', 'foo?{"q":"x"}', 'foo?bar?{}'],
        updatedAt: 1,
      });
      const { slice } = setupQueried({ storage });

      act(() => slice.remove('foo'));

      await waitFor(() => expect([...storage.rows.keys()]).toEqual(['user-1:personal|foo?bar?{}']));
      await waitFor(() =>
        expect(storage.indexRows.get('user-1:personal')?.data).toEqual(['foo?bar?{}']),
      );
    });

    it('calls a class-based storage with its receiver on every index pass', async () => {
      /** Prototype methods that rely on `this`, like most storage classes. */
      class ClassStorage implements ReplicaStorage<string[]> {
        rows = new Map<string, ReplicaRow<string[]>>();
        #id({ queryKey, scope }: { queryKey: string; scope: string }) {
          return `${scope}|${queryKey}`;
        }
        async get(key: { queryKey: string; scope: string }) {
          return this.rows.get(this.#id(key));
        }
        async getStrict(key: { queryKey: string; scope: string }) {
          return this.rows.get(this.#id(key));
        }
        async remove(key: { queryKey: string; scope: string }) {
          this.rows.delete(this.#id(key));
        }
        async set(key: { queryKey: string; scope: string }, row: ReplicaRow<string[]>) {
          this.rows.set(this.#id(key), row);
        }
      }
      const backing = new ClassStorage();
      const storage = { ...createMemoryStorage(), storage: backing };
      const dataRows = () =>
        [...backing.rows.keys()].filter((key) => !key.endsWith(REPLICA_INDEX_KEY));
      const first = setupQueried({ storage });
      act(() => {
        first.slice.replace({ id: 'a' }, ['a-all']);
        first.slice.replace({ id: 'a', q: 'x' }, ['a-x']);
        first.slice.replace({ id: 'b' }, ['b-all']);
      });
      await waitFor(() => expect(dataRows()).toHaveLength(3));
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

      // A fresh engine only finds the rows through the index.
      const { slice } = setupQueried({ storage });
      slice.updateEntity('x', (item) => item);
      act(() => slice.remove('a'));
      await waitFor(() => expect(dataRows()).toEqual(['user-1:personal|b?{}']));
      expect(await slice.clear()).toBe(true);
      expect(dataRows()).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it('drops the request record of a failure even without an onError', async () => {
      const requests: { fetch: () => Promise<unknown>; onError?: (error: unknown) => void }[] = [];
      const useQuery = vi.fn((key: any, fetch: () => Promise<unknown>, options: any) => {
        if (key?.[0] === 'replica:sync') requests.push({ fetch, onError: options.onError });
        return { isValidating: false, mutate: vi.fn() };
      });
      const { slice } = setupQueried({ driver: { revalidate: vi.fn(), useQuery } });
      const deletes = vi.spyOn(Map.prototype, 'delete');

      const { rerender } = renderHook((props: QueryParams) => slice.useSync(props), {
        initialProps: { id: 'k1' } as QueryParams,
      });
      for (const id of ['k1', 'k2', 'k3']) {
        rerender({ id });
        const request = requests.at(-1)!;
        await request.fetch();
        act(() => request.onError!(new Error('forbidden')));
      }

      const dropped = deletes.mock.calls.map(([id]) => String(id));
      for (const id of ['k1', 'k2', 'k3'])
        expect(
          dropped.some((record) => record.includes('replica:sync') && record.includes(id)),
        ).toBe(true);
      deletes.mockRestore();
    });

    it('clear wipes memory, every persisted row and the index of the active scope', async () => {
      const first = await persistVariants();
      // A later session loads only one entry; the rest is known only to the index.
      const { slice, storage, store } = setupQueried({ storage: first.storage });
      act(() => slice.replace({ id: 'b' }, ['b-all']));
      storage.rows.set('user-2:personal|a', { data: ['other-user'], updatedAt: 1 });

      let purge!: Promise<boolean>;
      act(() => {
        purge = slice.clear();
      });
      expect(store.getState().lists).toEqual({});
      expect(store.getState().listsReplica.entries).toEqual({});

      await act(async () => {
        expect(await purge).toBe(true);
      });
      // Only the other identity's row survives; the index lists nothing.
      expect([...storage.rows.keys()]).toEqual(['user-2:personal|a']);
      await waitFor(() => expect(storage.indexRows.get('user-1:personal')?.data).toEqual([]));
      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
    });

    it('clear refuses a hydrate that was already reading', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['wiped'], updatedAt: 1 });
      const originalGet = storage.storage.get;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      storage.storage.get = async (key) => {
        const value = await originalGet(key);
        if (key.queryKey === 'a') await held;
        return value;
      };
      const { slice, store } = setup({ storage });

      let hydration!: Promise<boolean>;
      await act(async () => {
        hydration = slice.hydrate({ id: 'a' });
      });
      act(() => {
        void slice.clear();
      });
      await act(async () => {
        release();
        expect(await hydration).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });

    it('clear discards a head response that started before it, and applies one started after', () => {
      const requests: { fetch: () => Promise<unknown>; onSuccess: (data: string[]) => void }[] = [];
      const useQuery = vi.fn((key: any, fetch: () => Promise<unknown>, options: any) => {
        if (key?.[0] === 'replica:sync') requests.push({ fetch, onSuccess: options.onSuccess });
        return { isValidating: false, mutate: vi.fn() };
      });
      const { slice, store } = setupQueried({ driver: { revalidate: vi.fn(), useQuery } });
      renderHook(() => slice.useSync({ id: 'a' }));
      const request = requests.at(-1)!;

      // The request is issued, then the resource is wiped before it settles.
      void request.fetch();
      act(() => {
        void slice.clear();
      });
      act(() => request.onSuccess(['before-clear']));
      expect(store.getState().lists.a).toBeUndefined();

      // A request issued after the clear is ordinary.
      void request.fetch();
      act(() => request.onSuccess(['after-clear']));
      expect(store.getState().lists.a).toEqual(['after-clear']);
    });

    it('a clear whose purge could not run keeps refusing hydration', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['stale'], updatedAt: 1 });
      const { slice, store } = setup({ storage });

      // Identity is not resolved yet, so the row deletes are refused.
      scopeState.trusted = false;
      let purge!: Promise<boolean>;
      act(() => {
        purge = slice.clear();
      });
      expect(await purge).toBe(false);
      scopeState.trusted = true;

      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });

    it('does not surface the error of a query the entry has moved past', () => {
      const requests: { onError: (error: unknown) => void; params: { q?: string } }[] = [];
      const useQuery = vi.fn((key: any, _fetch: unknown, options: any) => {
        if (key?.[0] === 'replica:sync')
          requests.push({ onError: options.onError, params: key.at(-1) });
        return { isValidating: false, mutate: vi.fn() };
      });
      const { slice } = setupQueried({ driver: { revalidate: vi.fn(), useQuery } });
      const onError = vi.fn();

      const { rerender } = renderHook((props: QueryParams) => slice.useSync(props, { onError }), {
        initialProps: { id: 'a' } as QueryParams,
      });
      rerender({ id: 'a', q: 'b' });

      const base = requests.find((request) => request.params.q === undefined)!;
      const search = requests.find((request) => request.params.q === 'b')!;

      // The superseded query fails late: the search on screen must not see it.
      act(() => base.onError(new Error('stale')));
      expect(onError).not.toHaveBeenCalled();

      const failure = new Error('search failed');
      act(() => search.onError(failure));
      expect(onError).toHaveBeenCalledWith(failure, {
        isActive: true,
        key: 'a',
        scope: 'user-1:personal',
      });
    });
  });
});
