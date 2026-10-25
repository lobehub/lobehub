/**
 * @vitest-environment happy-dom
 */
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { defineReplica } from '../core/defineReplica';
import { createReplicaState } from '../core/reducer';
import { createReplicaSlice, recordLens } from './createReplicaSlice';
import type { TestState } from './testUtils';
import { createMemoryStorage, resetScopeState, scope, setup } from './testUtils';

beforeEach(resetScopeState);

describe('createReplicaSlice', () => {
  describe('updateMany', () => {
    it('applies many keys as one commit and clones the record once', () => {
      const resource = defineReplica<{ id: string }, string[]>({
        fetcher: async () => ['server'],
        key: ({ id }) => id,
        name: 'batchedSeed',
        scope,
        version: 1,
      });
      const store = createStore<TestState>()(() => ({
        lists: {},
        listsReplica: createReplicaState(),
      }));
      const lens = recordLens<TestState, string[]>('lists');
      const setMany = vi.spyOn(lens, 'setMany');
      const set = vi.spyOn(lens, 'set');
      let commits = 0;
      const slice = createReplicaSlice<TestState, { id: string }, string[]>(resource, {
        driver: {
          revalidate: vi.fn(),
          useQuery: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
        },
        get: store.getState,
        set: (partial) => {
          commits += 1;
          store.setState(partial);
        },
        stateKey: 'listsReplica',
        view: lens,
      });

      act(() => {
        slice.updateMany([
          { apply: () => ['a'], key: 'a' },
          { apply: () => ['b'], key: 'b' },
          { apply: () => ['c'], key: 'c' },
        ]);
      });

      expect(store.getState().lists).toEqual({ a: ['a'], b: ['b'], c: ['c'] });
      // One host commit for the whole batch, and one clone of the record.
      expect(commits).toBe(1);
      expect(setMany).toHaveBeenCalledTimes(1);
      expect(set).not.toHaveBeenCalled();

      // An empty batch commits nothing.
      expect(slice.updateMany([])).toBe(false);
      expect(commits).toBe(1);
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
