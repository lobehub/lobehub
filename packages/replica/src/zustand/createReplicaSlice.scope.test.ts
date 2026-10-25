/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryStorage, resetScopeState, scopeState, setup, wrapper } from './testUtils';

beforeEach(resetScopeState);

describe('createReplicaSlice', () => {
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

    it('does not hydrate the persisted projection when the runtime opts out', async () => {
      // An identity-less runtime (e.g. the public Workbench) can only guess the
      // scope, so it must not read another session's rows back into memory.
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['someone-elses'], updatedAt: 1 });
      scopeState.canHydrate = false;
      const { slice, store } = setup({ storage });

      await act(async () => {
        await slice.hydrate({ id: 'a' });
      });

      expect(store.getState().lists.a).toBeUndefined();
      expect(store.getState().listsReplica.entries.a).toBeUndefined();
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

    it('retries a removal whose storage delete failed, instead of treating it as purged', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['stale'], updatedAt: 1 });
      const { slice } = setup({ storage });

      const original = storage.storage.remove;
      let attempts = 0;
      storage.storage.remove = async (key) => {
        attempts += 1;
        if (attempts === 1) throw new Error('IndexedDB delete failed');
        return original(key);
      };

      // The first delete is rejected by storage: the guard is armed, but the row
      // is still on disk and must NOT be treated as purged.
      act(() => slice.remove('a'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(storage.rows.get('user-1:personal|a')).toBeDefined();

      // A later terminal answer must retry the delete rather than no-op.
      act(() => slice.remove('a'));
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
      expect(attempts).toBeGreaterThanOrEqual(2);
    });

    it('retries the storage delete of a removal made while the scope was untrusted', async () => {
      const storage = createMemoryStorage();
      storage.rows.set('user-1:personal|a', { data: ['stale'], updatedAt: 1 });
      const { slice } = setup({ storage });

      // Cold boot: identity is not resolved, so writes are refused and the
      // delete never reaches storage — the hydration guard is armed all the same.
      scopeState.trusted = false;
      act(() => slice.remove('a'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(storage.rows.get('user-1:personal|a')).toBeDefined();

      // Identity resolves: the next removal must clear the row, not no-op.
      scopeState.trusted = true;
      act(() => slice.remove('a'));
      await waitFor(() => expect(storage.rows.get('user-1:personal|a')).toBeUndefined());
    });
  });
});
