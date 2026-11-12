import { randomUUID } from 'node:crypto';

import { act, cleanup } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { useDiscoverStore } from '@/store/discover';
import { initialState } from '@/store/discover/initialState';

/**
 * Test harness for the discover replicas persisted to IndexedDB: a fresh
 * identity scope per test, rows seeded through the storage namespace
 * (`replica:<name>:v1`) and removed afterwards, and an SWR provider per render.
 */

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

export const replicaWrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    createElement(MutateBridge),
    children,
  );

export const storageOf = (name: string) =>
  new AppIndexedDBStorage<unknown>({ namespace: `replica:${name}:v1` });

/** Never-resolving fetch: the first frame can only come from storage. */
export const pending = () => new Promise<never>(() => {});

export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

/** Install the per-test scope and cleanup; call once at the top of a `describe`. */
export const useReplicaHarness = (label: string) => {
  const state = { scope: '' };
  const seeded: { name: string; queryKey: string; scope: string }[] = [];

  beforeEach(() => {
    state.scope = `${label}-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => state.scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => state.scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useDiscoverStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    for (const row of seeded.splice(0)) {
      const storage = storageOf(row.name);
      await storage.remove({ queryKey: row.queryKey, scope: row.scope });
      await storage.remove({ queryKey: REPLICA_INDEX_KEY, scope: row.scope });
    }
    vi.restoreAllMocks();
  });

  return {
    /** Seed one persisted row (in another scope with `at`). */
    persist: async (name: string, queryKey: string, data: unknown, at = state.scope) => {
      seeded.push({ name, queryKey, scope: at });
      await storageOf(name).set({ queryKey, scope: at }, { data, updatedAt: 1 });
    },
    get scope() {
      return state.scope;
    },
    /** Read one persisted row of the active scope. */
    stored: async (name: string, queryKey: string) => {
      seeded.push({ name, queryKey, scope: state.scope });
      return (await storageOf(name).get({ queryKey, scope: state.scope }))?.data;
    },
  };
};
