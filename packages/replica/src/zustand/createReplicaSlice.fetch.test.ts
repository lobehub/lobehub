/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { REPLICA_INDEX_KEY } from '../core/engine';
import { replicaKeys } from '../core/keys';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from '../core/types';
import type { ReplicaEffects } from './createReplicaSlice';
import { createReplicaSlice, recordLens, ReplicaScopeChangedError } from './createReplicaSlice';
import type { ReplicaSyncDriver } from './driver';

type Value = string[] | null;

interface TestState {
  lists: Record<string, Value>;
  listsReplica: ReplicaState<Value>;
}

const scopeState = { current: 'user-1:personal' };
const scope: ReplicaScope = {
  canPersist: () => true,
  get: () => scopeState.current,
  use: () => scopeState.current,
};

const createMemoryStorage = () => {
  const rows = new Map<string, ReplicaRow<Value>>();
  const indexRows = new Map<string, ReplicaRow<Value>>();
  const read: ReplicaStorage<Value>['get'] = async ({ queryKey, scope }) =>
    queryKey === REPLICA_INDEX_KEY ? indexRows.get(scope) : rows.get(`${scope}|${queryKey}`);
  const storage: ReplicaStorage<Value> = {
    get: read,
    getStrict: read,
    remove: async ({ queryKey, scope }) => {
      if (queryKey === REPLICA_INDEX_KEY) return void indexRows.delete(scope);
      rows.delete(`${scope}|${queryKey}`);
    },
    set: async ({ queryKey, scope }, row) => {
      if (queryKey === REPLICA_INDEX_KEY) return void indexRows.set(scope, row);
      rows.set(`${scope}|${queryKey}`, row);
    },
  };
  return { rows, storage };
};

/** A fetcher whose responses resolve / reject on demand, in call order. */
const deferredFetcher = () => {
  const calls: { reject: (error: unknown) => void; resolve: (value: Value) => void }[] = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Value>((resolve, reject) => {
        calls.push({ reject, resolve });
      }),
  );
  return { calls, fetcher };
};

const setup = ({
  driver = testDriver,
  effects,
  fetcher = vi.fn(async () => ['server'] as Value),
  storage = createMemoryStorage(),
}: {
  driver?: ReplicaSyncDriver;
  effects?: ReplicaEffects<{ id: string }, Value>;
  fetcher?: (params: { id: string }) => Promise<Value>;
  storage?: ReturnType<typeof createMemoryStorage>;
} = {}) => {
  const resource = defineReplica<{ id: string }, Value>({
    fetcher,
    key: ({ id }) => id,
    name: 'fetchList',
    scope,
    storage: storage.storage,
    version: 1,
  });
  const store = createStore<TestState>()(() => ({
    lists: {},
    listsReplica: createReplicaState(),
  }));
  const slice = createReplicaSlice<TestState, { id: string }, Value>(resource, {
    driver,
    effects,
    get: store.getState,
    // `null` is the server's "this entry does not exist".
    isMissing: (data) => data === null,
    set: (partial) => store.setState(partial),
    stateKey: 'listsReplica',
    view: recordLens('lists'),
  });
  return { slice, storage, store };
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const effectSpies = () => ({
  onApplied: vi.fn(),
  onError: vi.fn(),
  onMissing: vi.fn(),
  onPurge: vi.fn(),
  onSettled: vi.fn(),
});

beforeEach(() => {
  scopeState.current = 'user-1:personal';
});

describe('createReplicaSlice fetch', () => {
  it('applies the head with no view mounted, persists it and runs onApplied', async () => {
    const effects = effectSpies();
    const { slice, storage, store } = setup({ effects });

    const result = await slice.fetch({ id: 'a' });

    expect(result).toEqual({ applied: true, data: ['server'], missing: false });
    expect(store.getState().lists.a).toEqual(['server']);
    expect(effects.onApplied).toHaveBeenCalledWith(
      ['server'],
      { id: 'a' },
      { key: 'a', scope: 'user-1:personal', source: 'fetch' },
    );
    await waitFor(() => expect(storage.rows.get('user-1:personal|a')?.data).toEqual(['server']));
  });

  it('drops a response captured under a scope the store has left, without effects', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice, storage, store } = setup({ effects, fetcher });

    const pending = slice.fetch({ id: 'a' });
    scopeState.current = 'user-2:personal';
    calls[0].resolve(['previous identity']);

    await expect(pending).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toBeUndefined();
    expect(effects.onApplied).not.toHaveBeenCalled();
    expect(storage.rows.size).toBe(0);
  });

  it('drops a response whose entry was removed while it was in flight', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice, store } = setup({ effects, fetcher });

    const pending = slice.fetch({ id: 'a' });
    slice.remove('a');
    calls[0].resolve(['deleted on the server']);

    await expect(pending).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toBeUndefined();
    expect(effects.onApplied).not.toHaveBeenCalled();
  });

  it('settles a discarded response so per-request bookkeeping can be released', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice } = setup({ effects, fetcher });

    const pending = slice.fetch({ id: 'a' });
    slice.remove('a');
    calls[0].resolve(['deleted on the server']);

    await expect(pending).resolves.toMatchObject({ applied: false });
    expect(effects.onSettled).toHaveBeenCalledWith(
      ['deleted on the server'],
      { id: 'a' },
      { key: 'a', scope: 'user-1:personal', source: 'fetch' },
    );
  });

  it('drops a response whose request started before a clear()', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice, store } = setup({ effects, fetcher });

    const pending = slice.fetch({ id: 'a' });
    await slice.clear();
    calls[0].resolve(['wiped']);

    await expect(pending).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toBeUndefined();
    expect(effects.onApplied).not.toHaveBeenCalled();
  });

  it('removes a terminal absence and runs onMissing in the active scope', async () => {
    const storage = createMemoryStorage();
    const effects = effectSpies();
    const { slice, store } = setup({ effects, fetcher: vi.fn(async () => null), storage });
    store.setState({ lists: { a: ['cached'] } });
    storage.rows.set('user-1:personal|a', { data: ['cached'], updatedAt: 1 });

    await expect(slice.fetch({ id: 'a' })).resolves.toEqual({
      applied: true,
      data: null,
      missing: true,
    });

    expect(store.getState().lists.a).toBeUndefined();
    expect(effects.onMissing).toHaveBeenCalledWith(
      { id: 'a' },
      { key: 'a', scope: 'user-1:personal', source: 'fetch' },
    );
    expect(effects.onApplied).not.toHaveBeenCalled();
    await waitFor(() => expect(storage.rows.has('user-1:personal|a')).toBe(false));
  });

  it('purges a late terminal absence in the scope it was captured under, without onMissing', async () => {
    const storage = createMemoryStorage();
    storage.rows.set('user-1:personal|a', { data: ['previous'], updatedAt: 1 });
    storage.rows.set('user-2:personal|a', { data: ['current'], updatedAt: 1 });
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice, store } = setup({ effects, fetcher, storage });
    store.setState({ lists: { a: ['current'] } });

    const pending = slice.fetch({ id: 'a' });
    scopeState.current = 'user-2:personal';
    calls[0].resolve(null);

    await expect(pending).resolves.toEqual({ applied: false, data: null, missing: true });
    // The row of the scope the request belonged to is gone…
    await waitFor(() => expect(storage.rows.has('user-1:personal|a')).toBe(false));
    // …while the scope on screen keeps its own value and runs no effects.
    expect(storage.rows.get('user-2:personal|a')?.data).toEqual(['current']);
    expect(store.getState().lists.a).toEqual(['current']);
    expect(effects.onMissing).not.toHaveBeenCalled();
    // Linked resources purge their own rows of that scope.
    expect(effects.onPurge).toHaveBeenCalledWith(
      { id: 'a' },
      { key: 'a', scope: 'user-1:personal', source: 'fetch' },
    );
  });

  it('rejects on a failed request after routing it to effects.onError with the captured scope', async () => {
    const failure = new Error('offline');
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const { slice } = setup({ effects, fetcher });

    const active = slice.fetch({ id: 'a' });
    calls[0].reject(failure);
    await expect(active).rejects.toBe(failure);
    expect(effects.onError).toHaveBeenLastCalledWith(
      failure,
      { id: 'a' },
      { isActive: true, key: 'a', scope: 'user-1:personal' },
    );

    const offScope = slice.fetch({ id: 'b' });
    scopeState.current = 'user-2:personal';
    calls[1].reject(failure);
    await expect(offScope).rejects.toBe(failure);
    expect(effects.onError).toHaveBeenLastCalledWith(
      failure,
      { id: 'b' },
      { isActive: false, key: 'b', scope: 'user-1:personal' },
    );
  });

  it('joins the request of a mounted useSync and settles it once', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const onSuccess = vi.fn();
    const { slice, store } = setup({ effects, fetcher });

    renderHook(() => slice.useSync({ id: 'a' }, { onSuccess }), { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    const pending = slice.fetch({ id: 'a' });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => calls[0].resolve(['server']));
    await expect(pending).resolves.toEqual({ applied: true, data: ['server'], missing: false });

    expect(store.getState().lists.a).toEqual(['server']);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // The resource effects run once for the shared request, not per path.
    expect(effects.onApplied).toHaveBeenCalledTimes(1);
    expect(effects.onApplied.mock.calls[0][2]).toMatchObject({ source: 'sync' });
  });

  it('runs the resource effects for useSync responses too', async () => {
    const effects = effectSpies();
    const { slice } = setup({ effects });

    renderHook(() => slice.useSync({ id: 'a' }), { wrapper });

    await waitFor(() =>
      expect(effects.onApplied).toHaveBeenCalledWith(
        ['server'],
        { id: 'a' },
        { key: 'a', scope: 'user-1:personal', source: 'sync' },
      ),
    );
  });

  it('settles a useSync response the hook moved past, with its resource effects', async () => {
    const { calls, fetcher } = deferredFetcher();
    const effects = effectSpies();
    const onSuccess = vi.fn();
    const { slice, store } = setup({ effects, fetcher });

    const { rerender } = renderHook(({ id }) => slice.useSync({ id }, { onSuccess }), {
      initialProps: { id: 'a' },
      wrapper,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ id: 'b' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    // `a` answers "gone" after the view moved to `b`: the driver no longer
    // calls this hook back for it, yet the absence is still settled.
    store.setState({ lists: { a: ['cached'] } });
    await act(async () => calls[0].resolve(null));

    expect(store.getState().lists.a).toBeUndefined();
    expect(effects.onMissing).toHaveBeenCalledWith(
      { id: 'a' },
      { key: 'a', scope: 'user-1:personal', source: 'sync' },
    );
    // The view's own callback is not run for a key it left.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('releases the record of a sync request whose callback the driver skipped', async () => {
    const { calls, fetcher } = deferredFetcher();
    const { slice } = setup({ fetcher });

    const { rerender, unmount } = renderHook(({ id }) => slice.useSync({ id }), {
      initialProps: { id: 'a' },
      wrapper,
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    rerender({ id: 'b' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    rerender({ id: 'c' });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    unmount();

    // Every request answers after its hook moved on or unmounted: the driver
    // runs none of the callbacks that would have taken the records.
    await act(async () => {
      for (const call of calls) call.resolve(['server']);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    expect(slice.debugPendingSyncRequests()).toBe(0);
  });

  it('settles a fetch into the scope its caller captured, and refuses one that left it', async () => {
    const { calls, fetcher } = deferredFetcher();
    const { slice, store } = setup({ fetcher });

    const pending = slice.fetch({ id: 'a' }, { scope: 'user-1:personal' });
    scopeState.current = 'user-2:personal';
    calls[0].resolve(['previous identity']);
    await expect(pending).resolves.toMatchObject({ applied: false });

    // A later step of the same flow must not fetch the new identity's data
    // under the old identity's label.
    await expect(slice.fetch({ id: 'b' }, { scope: 'user-1:personal' })).rejects.toBeInstanceOf(
      ReplicaScopeChangedError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.getState().lists).toEqual({});
  });

  it('a fresh fetch retires the requests started before it', async () => {
    const { calls, fetcher } = deferredFetcher();
    const { slice, store } = setup({ fetcher });

    const stale = slice.fetch({ id: 'a' });
    const fresh = slice.fetch({ id: 'a' }, { fresh: true });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The pre-mutation request answers first: it may not paint even briefly.
    calls[0].resolve(['before mutation']);
    await expect(stale).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toBeUndefined();

    calls[1].resolve(['after mutation']);
    await expect(fresh).resolves.toMatchObject({ applied: true });
    expect(store.getState().lists.a).toEqual(['after mutation']);
  });

  it('keeps no retirement records once nothing older is in flight', async () => {
    const { slice } = setup();

    for (let index = 0; index < 50; index++) {
      await slice.fetch({ id: `doc-${index}` });
      await slice.fetch({ id: `doc-${index}` }, { fresh: true });
    }

    expect(slice.debugRetiredRequests()).toBe(0);
  });

  it('keeps a retirement while an older request is in flight, then prunes it', async () => {
    const { calls, fetcher } = deferredFetcher();
    const { slice, store } = setup({ fetcher });

    const older = slice.fetch({ id: 'a' });
    const newer = slice.fetch({ id: 'a' }, { fresh: true });
    calls[1].resolve(['newer']);
    await newer;
    // The older request is still pending: its retirement must survive pruning.
    expect(slice.debugRetiredRequests()).toBe(1);

    calls[0].resolve(['older']);
    await expect(older).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toEqual(['newer']);
    expect(slice.debugRetiredRequests()).toBe(0);
  });

  it('drops an older response once a newer one for the entry has applied', async () => {
    const { calls, fetcher } = deferredFetcher();
    const { slice, store } = setup({ fetcher });

    const older = slice.fetch({ id: 'a' });
    const newer = slice.fetch({ id: 'a' }, { fresh: true });
    calls[1].resolve(['newer']);
    await newer;
    calls[0].resolve(['older']);

    await expect(older).resolves.toMatchObject({ applied: false });
    expect(store.getState().lists.a).toEqual(['newer']);
  });

  it('seeds the driver cache under the sync key only while no useSync request is in flight', async () => {
    const seed = vi.fn();
    const driver: ReplicaSyncDriver = { ...testDriver, seed };
    const { slice } = setup({ driver });

    await slice.fetch({ id: 'a' });

    expect(seed).toHaveBeenCalledWith(
      replicaKeys.sync('fetchList', 1, 'user-1:personal', 'a', { id: 'a' }),
      ['server'],
    );

    const { calls, fetcher } = deferredFetcher();
    const joined = setup({ driver, fetcher });
    seed.mockClear();
    renderHook(() => joined.slice.useSync({ id: 'b' }), { wrapper });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const pending = joined.slice.fetch({ id: 'b' });
    await act(async () => calls[0].resolve(['server']));
    await pending;
    // The mounted query fills its own cache entry.
    expect(seed).not.toHaveBeenCalled();
  });

  it('works with a driver that has no cache of its own', async () => {
    const driver: ReplicaSyncDriver = {
      revalidate: vi.fn(async () => undefined),
      useQuery: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
    };
    const { slice, store } = setup({ driver });

    await expect(slice.fetch({ id: 'a' })).resolves.toMatchObject({ applied: true });
    expect(store.getState().lists.a).toEqual(['server']);
  });
});
