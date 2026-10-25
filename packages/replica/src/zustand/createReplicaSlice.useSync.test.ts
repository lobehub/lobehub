/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { createReplicaState } from '../core/reducer';
import { createReplicaSlice, recordLens } from './createReplicaSlice';
import type { TestState } from './testUtils';
import { createMemoryStorage, resetScopeState, scope, scopeState, setup, wrapper } from './testUtils';

beforeEach(resetScopeState);

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
      // The callback also receives the key/scope the failing read was captured
      // under, so a terminal removal can be bound to the right scope.
      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(failure, {
          isActive: true,
          key: 'b',
          scope: 'user-1:personal',
        }),
      );
      expect(failing.store.getState().lists.b).toBeUndefined();
    });

    it('runs onHydrated with the hydrated value, and skips it when nothing was stored', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });
      let resolveFetch!: (value: string[]) => void;
      const fetcher = vi.fn(() => new Promise<string[]>((resolve) => (resolveFetch = resolve)));
      const { slice, store } = setup({ fetcher, storage });
      const seen: string[][] = [];
      renderHook(() => slice.useSync({ id: 'a' }, { onHydrated: (data) => seen.push(data) }), {
        wrapper,
      });

      await waitFor(() => expect(store.getState().lists.a).toEqual(['cached']));
      expect(seen).toEqual([['cached']]);

      await act(async () => resolveFetch(['server']));
      await waitFor(() => expect(store.getState().lists.a).toEqual(['server']));
      // The network response stays `onSuccess`'s job; onHydrated does not fire for it.
      expect(seen).toEqual([['cached']]);

      // An empty slot has no persisted value, so nothing is replayed.
      const empty = setup();
      const missed = vi.fn();
      renderHook(() => empty.slice.useSync({ id: 'b' }, { onHydrated: missed }), { wrapper });
      await waitFor(() => expect(empty.store.getState().lists.b).toEqual(['server']));
      expect(missed).not.toHaveBeenCalled();
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

    it('does not let a slow hydration resurrect an entry removed while it was in flight', async () => {
      // A NOT_FOUND / FORBIDDEN response removes the entry (and its row) while
      // the persisted read is still in flight. That read already holds the old
      // row, so landing it afterwards would repaint the value just dropped.
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const originalGet = storage.storage.get;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      storage.storage.get = async (key) => {
        const row = await originalGet(key);
        if (key.queryKey === 'a') await held;
        return row;
      };
      const { slice, store } = setup({ storage });

      let hydration!: Promise<boolean>;
      await act(async () => {
        hydration = slice.hydrate({ id: 'a' });
      });

      // The network answers first and drops the entry.
      act(() => slice.remove('a'));
      expect(store.getState().lists.a).toBeUndefined();

      // The slow read settles: it must not paint the row the removal dropped.
      await act(async () => {
        release();
        await hydration;
      });

      expect(store.getState().lists.a).toBeUndefined();
      expect(store.getState().listsReplica.entries.a).toBeUndefined();
    });

    it('refuses to hydrate a key that was explicitly removed even if its row is still on disk', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const { slice, store } = setup({ storage });

      act(() => slice.remove('a'));
      // The delete may not have flushed yet — the row must not come back anyway.
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });

      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });

    it('lets a later server value supersede a removal so the key hydrates again', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const { slice, store } = setup({ storage });

      act(() => slice.remove('a'));
      // Access restored: the server now answers with a value again.
      act(() => slice.replace({ id: 'a' }, ['regranted']));
      expect(store.getState().lists.a).toEqual(['regranted']);
      // Let the confirmed value reach the persisted row before reading it back.
      await waitFor(() =>
        expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['regranted']),
      );

      // Drop memory the way a scope switch does, then come back: with the
      // removal superseded, the persisted row may hydrate once more.
      scopeState.current = 'user-2:personal';
      act(() => slice.ensureScope('user-2:personal'));
      scopeState.current = 'user-1:personal';
      act(() => slice.ensureScope('user-1:personal'));

      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(true);
      });
      expect(store.getState().lists.a).toEqual(['regranted']);
    });

    it('reports a keyless (disabled) read as hydrated, so it never looks loading', () => {
      const { slice } = setup();

      const { result } = renderHook(() => slice.useSync(null), { wrapper });

      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isValidating).toBe(false);
    });

    it('keeps the removal guard when a response captured under another scope is discarded', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      // The persisted-row delete is best-effort: simulate it still being pending.
      storage.storage.remove = async () => {};
      const { slice, store } = setup({ storage });

      // Scope A removes the entry (and arms its guard).
      act(() => slice.remove('a'));

      // A response captured under A resolves only after the user switched to B,
      // so `dispatch` drops it. It must not clear A's guard on the way out.
      scopeState.current = 'user-2:personal';
      act(() => slice.replace({ id: 'a' }, ['stale'], 'user-1:personal'));

      // Switching back to A must still refuse to hydrate the stale row.
      scopeState.current = 'user-1:personal';
      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });
  });
});
