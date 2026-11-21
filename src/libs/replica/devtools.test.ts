import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import {
  getReplicaDevtoolsVersion,
  listReplicaDevtools,
  subscribeReplicaDevtools,
} from './devtools';
import {
  createReplicaSlice,
  createReplicaState,
  defineReplica,
  recordLens,
  type ReplicaState,
} from './index';

vi.mock('@/libs/swr', () => ({ mutate: vi.fn(), useClientDataSWR: vi.fn() }));

interface TestState {
  lists: Record<string, string[]>;
  listsReplica: ReplicaState<string[]>;
}

const createFixture = (name: string) => {
  const resource = defineReplica<{ id: string }, string[]>({
    key: ({ id }) => id,
    name,
    scope: { canPersist: () => false, get: () => 'user-1:personal', use: () => 'user-1:personal' },
    storage: 'memory',
    version: 1,
  });
  const store = createStore<TestState>()(() => ({
    lists: {},
    listsReplica: createReplicaState(),
  }));
  const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
    get: store.getState,
    set: (partial) => store.setState(partial),
    stateKey: 'listsReplica',
    view: recordLens('lists'),
  });
  const entry = () => listReplicaDevtools().find((item) => item.resource === resource)!;
  return { entry, slice, store };
};

describe('replica devtools registry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('exposes every app slice with its live entries and writes back through the slice', () => {
    const { entry, slice, store } = createFixture('devtoolsList');

    slice.update('a', () => ['one']);

    expect(entry().keys()).toEqual(['a']);
    expect(entry().read('a')).toEqual(['one']);
    expect(entry().state()?.entries.a?.source).toBe('local');

    entry().update('a', ['two'], { persist: false });
    expect(store.getState().lists.a).toEqual(['two']);

    entry().remove('a');
    expect(entry().keys()).toEqual([]);
  });

  it('replaces the registration when a store is rebuilt for the same resource', () => {
    createFixture('devtoolsRebuilt');
    const { entry, slice } = createFixture('devtoolsRebuilt');

    slice.update('b', () => ['fresh']);

    expect(
      listReplicaDevtools().filter(({ resource }) => resource.name === 'devtoolsRebuilt'),
    ).toHaveLength(1);
    expect(entry().read('b')).toEqual(['fresh']);
  });

  it('coalesces commits into one notification per interval, only while subscribed', () => {
    const { slice } = createFixture('devtoolsNotify');
    const idleVersion = getReplicaDevtoolsVersion();

    slice.update('a', () => ['unobserved']);
    vi.runAllTimers();
    expect(getReplicaDevtoolsVersion()).toBe(idleVersion);

    const listener = vi.fn();
    const unsubscribe = subscribeReplicaDevtools(listener);

    slice.update('a', () => ['one']);
    slice.update('a', () => ['two']);
    slice.update('b', () => ['three']);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(listener).toHaveBeenCalledOnce();
    expect(getReplicaDevtoolsVersion()).toBe(idleVersion + 1);

    unsubscribe();
  });
});
