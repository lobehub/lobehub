import { describe, expect, it, vi } from 'vitest';

import { KeyValueReplicaStorage, type ReplicaKeyValueStore } from './keyValue';

const createStore = (overrides: Partial<ReplicaKeyValueStore> = {}) => {
  const rows = new Map<string, unknown>();
  const store: ReplicaKeyValueStore = {
    delete: vi.fn(async (key: string) => {
      rows.delete(key);
    }),
    get: vi.fn(async (key: string) => rows.get(key)),
    initialize: vi.fn(async () => {}),
    set: vi.fn(async (key: string, value: unknown) => {
      rows.set(key, value);
    }),
    ...overrides,
  };
  return { rows, store };
};

describe('KeyValueReplicaStorage', () => {
  it('stores one scoped record per row, after opening the store', async () => {
    const { rows, store } = createStore();
    const storage = new KeyValueReplicaStorage<string[]>({ namespace: 'projects', store });
    const key = { queryKey: 'detail:1', scope: 'user:workspace' };

    await storage.set(key, { data: ['cached'], updatedAt: 1 });

    expect(store.initialize).toHaveBeenCalled();
    expect([...rows.keys()]).toEqual(['projects:user%3Aworkspace:detail%3A1']);
    await expect(storage.get(key)).resolves.toEqual({ data: ['cached'], updatedAt: 1 });
    await expect(storage.get({ ...key, scope: 'other' })).resolves.toBeUndefined();
  });

  it('works with a store that needs no initialization', async () => {
    const { store } = createStore({ initialize: undefined });
    const storage = new KeyValueReplicaStorage<number>({ namespace: 'n', store });
    const key = { queryKey: 'q', scope: 's' };

    await storage.set(key, { data: 1, updatedAt: 1 });
    await storage.remove(key);

    await expect(storage.getStrict(key)).resolves.toBeUndefined();
  });

  it('rejects a write that did not land, so the replica retries it', async () => {
    const { store } = createStore({ set: vi.fn().mockRejectedValue(new Error('aborted')) });
    const storage = new KeyValueReplicaStorage<string[]>({ namespace: 'projects', store });

    await expect(
      storage.set({ queryKey: 'all', scope: 'personal' }, { data: ['x'], updatedAt: 1 }),
    ).rejects.toThrow('aborted');
  });

  it('treats a store that cannot open as a cache miss', async () => {
    const { store } = createStore({
      initialize: vi.fn().mockRejectedValue(new Error('unavailable')),
    });
    const storage = new KeyValueReplicaStorage<string[]>({ namespace: 'projects', store });

    await expect(storage.get({ queryKey: 'all', scope: 'personal' })).resolves.toBeUndefined();
  });

  it('reports a failed delete so the caller can retry it', async () => {
    const { store } = createStore({ delete: vi.fn().mockRejectedValue(new Error('closed')) });
    const storage = new KeyValueReplicaStorage<string[]>({ namespace: 'projects', store });

    await expect(storage.remove({ queryKey: 'all', scope: 'personal' })).rejects.toThrow('closed');
  });

  it('rejects a strict read that failed, while get stays a cache miss', async () => {
    const { store } = createStore({ get: vi.fn().mockRejectedValue(new Error('closed')) });
    const storage = new KeyValueReplicaStorage<string[]>({ namespace: 'projects', store });
    const key = { queryKey: '__replica:index', scope: 'personal' };

    await expect(storage.getStrict(key)).rejects.toThrow('closed');
    await expect(storage.get(key)).resolves.toBeUndefined();
  });
});
