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
  describe('useSync', () => {
    it('runs the caller success side effects when the response changes nothing', () => {
      // `replace` reports false both for a rejected response and for one with
      // nothing to write (an unchanged revalidation, or `undefined` for an id the
      // server no longer has). Callers rely on onSuccess in the latter cases —
      // e.g. removing a cached detail the server answered with nothing.
      const requests: { onSuccess: (data: string[] | undefined) => void }[] = [];
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        if (key !== null && options?.onSuccess) requests.push({ onSuccess: options.onSuccess });
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'noopSuccessSideEffects',
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: { a: ['same'] },
        listsReplica: createReplicaState(),
      }));
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: { revalidate: vi.fn(), useQuery },
        get: store.getState,
        set: (partial) => store.setState(partial),
        stateKey: 'listsReplica',
        view: recordLens('lists'),
      });

      scopeState.current = 'user-1:personal';
      const onSuccess = vi.fn();
      renderHook(() => slice.useSync({ id: 'a' }, { onSuccess }), { wrapper });
      const request = requests.find((entry) => entry)!;

      act(() => request.onSuccess(['same']));
      act(() => request.onSuccess(['same']));
      act(() => request.onSuccess(undefined));

      expect(onSuccess).toHaveBeenCalledTimes(3);
      expect(onSuccess).toHaveBeenLastCalledWith(undefined);
    });

    it("drops a settled request's success side effects once the store has left its scope", () => {
      // A response can settle after an identity/workspace switch. The engine
      // refuses the off-scope `replace`, but the caller's callbacks carry the
      // previous identity's side effects, so they must not run either — and a
      // switch to a scope reading the same key/query defeats both the
      // moved-past-query and since-clear guards.
      const requests: {
        onError: (error: unknown) => void;
        onSuccess: (data: string[]) => void;
      }[] = [];
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        if (key !== null) requests.push({ onError: options.onError, onSuccess: options.onSuccess });
        return { isValidating: false, mutate: vi.fn() };
      });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'staleScopeCallbacks',
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

      const onSuccess = vi.fn();
      const onError = vi.fn();
      renderHook(() => slice.useSync({ id: 'a' }, { onError, onSuccess }), { wrapper });

      const captured = requests.find((request) => request)!;

      // The identity/workspace switches while the request is still in flight.
      scopeState.current = 'user-2:personal';

      act(() => captured.onSuccess(['stale']));
      expect(onSuccess).not.toHaveBeenCalled();
      expect(store.getState().lists.a).toBeUndefined();

      // A failure is still handed over, bound to the scope it was captured
      // under and flagged as no longer active, so the caller can purge that
      // scope's row (see below) without repainting the current view.
      act(() => captured.onError(new Error('stale')));
      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        isActive: false,
        key: 'a',
        scope: 'user-1:personal',
      });
    });

    it('lets a late terminal error purge its captured scope through the sync callback', async () => {
      const requests: { onError: (error: unknown) => void }[] = [];
      const useQuery = vi.fn((key: any, _fetcher: unknown, options: any) => {
        // The sync request carries the callbacks; the hydration read does not.
        if (key !== null && options?.onError) requests.push({ onError: options.onError });
        return { isValidating: false, mutate: vi.fn() };
      });
      const memory = createMemoryStorage();
      memory.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'lateTerminalError',
        scope,
        storage: memory.storage,
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

      scopeState.current = 'user-1:personal';
      const contexts: { isActive: boolean; key: string | undefined; scope: string }[] = [];
      renderHook(
        () =>
          slice.useSync(
            { id: 'a' },
            {
              onError: (_error, context) => {
                contexts.push(context);
                if (context.key) slice.remove(context.key, context.scope);
              },
            },
          ),
        { wrapper },
      );
      const request = requests.find((entry) => entry)!;

      // The identity switches and loads its own entry before the denial lands.
      scopeState.current = 'user-2:personal';
      act(() => slice.replace({ id: 'a' }, ['b-value']));

      act(() => request.onError(new Error('NOT_FOUND')));

      // The callback still runs, flagged as belonging to a scope left behind, so
      // the consumer can purge that scope without repainting the current one.
      expect(contexts[0]).toMatchObject({ isActive: false, key: 'a', scope: 'user-1:personal' });
      // The scope on screen keeps its entry; the denied scope's row is purged.
      expect(store.getState().lists.a).toEqual(['b-value']);
      await waitFor(() => expect(memory.rows.get('user-1:personal|a')).toBeUndefined());
    });

    // The guard lives in the engine, per scope — not in the bookkeeping slot a
    // scope reset wipes — so an A → B → A round trip cannot lift it.
    it('keeps the removal guard across a scope round trip', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      // The persisted-row delete is still pending: the stale row stays on disk.
      storage.storage.remove = async () => {};
      const { slice, store } = setup({ storage });

      act(() => slice.remove('a'));

      scopeState.current = 'user-2:personal';
      act(() => slice.ensureScope('user-2:personal'));
      expect(store.getState().listsReplica.scope).toBe('user-2:personal');
      scopeState.current = 'user-1:personal';
      act(() => slice.ensureScope('user-1:personal'));

      await act(async () => {
        expect(await slice.hydrate({ id: 'a' })).toBe(false);
      });
      expect(store.getState().lists.a).toBeUndefined();
    });

    it('purges the captured scope row for a removal that lands after a scope switch', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const { slice, store } = setup({ storage });

      // The active scope has its own entry loaded.
      scopeState.current = 'user-2:personal';
      act(() => slice.replace({ id: 'a' }, ['b-value']));
      expect(store.getState().lists.a).toEqual(['b-value']);

      // A late NOT_FOUND from a request captured under the previous scope must
      // not delete the entry that is on screen now…
      act(() => slice.remove('a', 'user-1:personal'));
      expect(store.getState().lists.a).toEqual(['b-value']);

      // …but that scope's own persisted row still has to go, or switching back
      // to it would hydrate the value the server just denied.
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
    });

    it('retries an off-scope purge once the captured scope may persist again', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['revoked'], updatedAt: 1 });
      const { slice } = setup({ storage });

      // The terminal answer lands while writes are still refused.
      scopeState.current = 'user-2:personal';
      scopeState.trusted = false;
      act(() => slice.remove('a', 'user-1:personal'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.rows.get('user-1:personal|a')).toBeDefined();

      // Identity resolves: the next terminal answer must clear the row, not
      // report a no-op that never deletes it.
      scopeState.trusted = true;
      act(() => slice.remove('a', 'user-1:personal'));
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
    });

    it('binds the captured key and scope to the error callback', async () => {
      const fetcher = vi.fn(async () => {
        throw new Error('not found');
      });
      const { slice } = setup({ fetcher });
      const contexts: { isActive: boolean; key: string | undefined; scope: string }[] = [];

      scopeState.current = 'user-1:personal';
      renderHook(
        () => slice.useSync({ id: 'a' }, { onError: (_error, context) => contexts.push(context) }),
        { wrapper },
      );

      await waitFor(() => expect(contexts.length).toBeGreaterThan(0));
      expect(contexts[0]).toEqual({ isActive: true, key: 'a', scope: 'user-1:personal' });
    });

    it('evicts the persisted row when a response has nothing to persist', async () => {
      // Two bindings share one storage, so the second one reads what the first
      // one left behind — a reload of the same resource.
      const storage = createMemoryStorage();
      const bind = () => {
        const resource = defineReplica<{ id: string }, string[]>({
          key: ({ id }) => id,
          name: 'evictingList',
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
          // `['gone']` is a page state that must never be persisted.
          toPersisted: (data) => (data[0] === 'gone' ? null : data),
          view: recordLens('lists'),
        });
        return { slice, store };
      };

      const first = bind();
      act(() => {
        first.slice.replace({ id: 'a' }, ['cached']);
      });
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['cached']));

      act(() => {
        first.slice.replace({ id: 'a' }, ['gone']);
      });
      // The value stays in memory…
      expect(first.store.getState().lists.a).toEqual(['gone']);
      // …while the row persisted for it earlier is removed.
      await waitFor(() => expect(storage.rows.has('user-1:personal|a')).toBe(false));

      // A reload hydrates nothing instead of resurrecting the evicted value.
      const reloaded = bind();
      await act(async () => {
        await reloaded.slice.hydrate({ id: 'a' });
      });
      expect(reloaded.store.getState().lists.a).toBeUndefined();
    });

    it('clears a reloaded key from the persisted index when the response has nothing to persist', async () => {
      const storage = createMemoryStorage();
      const indexKey = { queryKey: REPLICA_INDEX_KEY, scope: 'user-1:personal' };
      const bind = () => {
        const resource = defineReplica<{ id: string }, string[]>({
          key: ({ id }) => id,
          name: 'indexedList',
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
          toPersisted: (data) => (data[0] === 'gone' ? null : data),
          view: recordLens('lists'),
        });
        return { slice, store };
      };

      const first = bind();
      act(() => {
        first.slice.replace({ id: 'a' }, ['cached']);
      });
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['cached']));
      await waitFor(async () => expect((await storage.storage.get(indexKey))?.data).toEqual(['a']));

      // A reload: a fresh engine whose in-memory index bookkeeping is empty, so
      // only the persisted index knows the key is there.
      const reloaded = bind();
      await act(async () => {
        await reloaded.slice.hydrate({ id: 'a' });
      });
      expect(reloaded.store.getState().lists.a).toEqual(['cached']);

      act(() => {
        reloaded.slice.replace({ id: 'a' }, ['gone']);
      });
      // The row goes…
      await waitFor(() => expect(storage.rows.has('user-1:personal|a')).toBe(false));
      // …and so does its index entry, so later entity scans do not chase a
      // missing row.
      await waitFor(async () => expect((await storage.storage.get(indexKey))?.data).toEqual([]));
    });

    // The removal deletes the entry, but a storage read that started before it
    // can still resolve afterwards; the replica must not let that stale read
    // resurrect the removed entry (the server already confirmed it gone).
    it('does not let a hydrate that resolves after a removal resurrect the entry', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['stale'], updatedAt: 1 });
      const realGet = storage.storage.get.bind(storage.storage);
      let releaseRead!: () => void;
      const readGate = new Promise<void>((resolve) => (releaseRead = resolve));
      let readStarted = false;
      vi.spyOn(storage.storage, 'get').mockImplementation(async (key) => {
        if (key.queryKey === 'a') {
          // A storage read is a snapshot: capture the row now, resolve later.
          const snapshot = await realGet(key);
          readStarted = true;
          await readGate;
          return snapshot;
        }
        return realGet(key);
      });

      // A network that never answers, so only the hydrate is at play.
      const { slice, store } = setup({ fetcher: () => new Promise<string[]>(() => {}), storage });

      let hydrated = false;
      const session = renderHook(
        () => slice.useSync({ id: 'a' }, { onHydrated: () => (hydrated = true) }),
        { wrapper },
      );
      await waitFor(() => expect(readStarted).toBe(true));

      // The key is removed (a server-confirmed absence) before the read lands.
      act(() => slice.remove('a'));

      releaseRead();
      await act(async () => {});

      expect(hydrated).toBe(false);
      expect(store.getState().lists.a).toBeUndefined();
      expect(store.getState().listsReplica.entries.a).toBeUndefined();
      session.unmount();
    });

    // a → b → a: a's hydration query already settled and is not re-run, so its
    // side effects must be replayed off the cached value when `a` is active again
    // — or they stay pointed at `b` until (or, offline, without) a response.
    it('replays onHydrated when a hydrated key becomes active again', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached-a'], updatedAt: 1 });
      storage.rows.set('user-1:personal|b', { data: ['cached-b'], updatedAt: 1 });
      // Offline: the network never answers, so only hydration can run effects.
      const { slice, store } = setup({ fetcher: () => new Promise<string[]>(() => {}), storage });
      const seen: string[][] = [];

      const session = renderHook(
        ({ id }: { id: string }) =>
          slice.useSync({ id }, { onHydrated: (data) => seen.push(data) }),
        { initialProps: { id: 'a' }, wrapper },
      );
      await waitFor(() => expect(session.result.current.isHydrated).toBe(true));
      // The first activation runs it once, from the hydrate itself.
      expect(seen).toEqual([['cached-a']]);

      session.rerender({ id: 'b' });
      await waitFor(() => expect(seen).toEqual([['cached-a'], ['cached-b']]));

      session.rerender({ id: 'a' });
      await waitFor(() => expect(seen).toEqual([['cached-a'], ['cached-b'], ['cached-a']]));
      expect(store.getState().lists.a).toEqual(['cached-a']);

      // A plain re-render of the same key does not replay again.
      session.rerender({ id: 'a' });
      await act(async () => {});
      expect(seen).toHaveLength(3);
      session.unmount();
    });

    // Scope A → B → A with the same key: B's activation cleared the view and
    // A's `once` hydration result is reused, so the slice must read A's
    // partition again — offline, nothing else would bring the row back.
    it('rehydrates an entry after returning to a prior scope', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['cached-a1'], updatedAt: 1 });
      storage.rows.set('user-2:personal|a', { data: ['cached-a2'], updatedAt: 1 });
      const { slice, store } = setup({ fetcher: () => new Promise<string[]>(() => {}), storage });
      const seen: string[][] = [];

      const session = renderHook(
        () => slice.useSync({ id: 'a' }, { onHydrated: (data) => seen.push(data) }),
        { wrapper },
      );
      await waitFor(() => expect(store.getState().lists.a).toEqual(['cached-a1']));

      scopeState.current = 'user-2:personal';
      session.rerender();
      await waitFor(() => expect(store.getState().lists.a).toEqual(['cached-a2']));

      scopeState.current = 'user-1:personal';
      session.rerender();
      await waitFor(() => expect(store.getState().lists.a).toEqual(['cached-a1']));
      // Its side effects follow the row back too.
      await waitFor(() => expect(seen.at(-1)).toEqual(['cached-a1']));
      session.unmount();
    });

    // A lookup that missed storage settles `true` as well; reactivating its key
    // must not replay `onHydrated` off a value that never came from storage
    // (a provisional seed written into the view).
    it('does not replay onHydrated for a reactivated key whose lookup missed storage', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|b', { data: ['cached-b'], updatedAt: 1 });
      const { slice } = setup({ fetcher: () => new Promise<string[]>(() => {}), storage });
      const seen: string[][] = [];

      const session = renderHook(
        ({ id }: { id: string }) =>
          slice.useSync({ id }, { onHydrated: (data) => seen.push(data) }),
        { initialProps: { id: 'a' }, wrapper },
      );
      await waitFor(() => expect(session.result.current.isHydrated).toBe(true));
      expect(seen).toEqual([]);

      session.rerender({ id: 'b' });
      await waitFor(() => expect(seen).toEqual([['cached-b']]));

      // A seed lands in `a`'s view while the hook shows `b`.
      act(() => {
        slice.update('a', () => ['seed-a'], { persist: false, source: 'seed' });
      });
      session.rerender({ id: 'a' });
      await act(async () => {});
      expect(seen).toEqual([['cached-b']]);
      session.unmount();
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
});
