import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { testDriver as driver } from '../../tests/testDriver';
import { defineReplica } from '../core/defineReplica';
import { REPLICA_INDEX_KEY } from '../core/engine';
import { createReplicaState } from '../core/reducer';
import type { ReplicaRow, ReplicaScope, ReplicaState, ReplicaStorage } from '../core/types';
import { createReplicaSlice, recordLens } from './createReplicaSlice';

export interface TestState {
  lists: Record<string, string[]>;
  listsReplica: ReplicaState<string[]>;
}

export const scopeState = { canHydrate: true, current: 'user-1:personal', trusted: true };
export const scope: ReplicaScope = {
  canHydrate: () => scopeState.canHydrate,
  canPersist: () => scopeState.trusted,
  get: () => scopeState.current,
  // The real `use` is `useCacheScope`; a plain getter is enough for these tests.
  use: () => scopeState.current,
};

/** In-memory storage that records every write, keyed like the real ones. */
export const createMemoryStorage = (delays: Record<string, number> = {}) => {
  const rows = new Map<string, ReplicaRow<string[]>>();
  const writes: string[] = [];
  const indexRows = new Map<string, ReplicaRow<string[]>>();
  const read: ReplicaStorage<string[]>['get'] = async ({ queryKey, scope }) =>
    queryKey === REPLICA_INDEX_KEY
      ? (indexRows.get(scope) as ReplicaRow<string[]> | undefined)
      : rows.get(`${scope}|${queryKey}`);
  const storage: ReplicaStorage<string[]> = {
    get: read,
    getStrict: read,
    remove: async ({ queryKey, scope }) => {
      if (queryKey === REPLICA_INDEX_KEY) return void indexRows.delete(scope);
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

export const setup = ({
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

export const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** Reset the shared scope to a trusted, hydratable `user-1:personal`. */
export const resetScopeState = () => {
  scopeState.canHydrate = true;
  scopeState.current = 'user-1:personal';
  scopeState.trusted = true;
};
