import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalStorageReplicaStorage } from './localStorage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('LocalStorageReplicaStorage', () => {
  it('restores a scoped row synchronously before the next paint', () => {
    const storage = new LocalStorageReplicaStorage<string[]>({ namespace: 'test' });
    const key = { queryKey: 'display', scope: 'user-a' };

    void storage.set(key, { data: ['cached'], updatedAt: 1 });

    expect(storage.getSync(key)).toEqual({ data: ['cached'], updatedAt: 1 });
    expect(storage.getSync({ ...key, scope: 'user-b' })).toBeUndefined();
  });

  it('isolates rows by scope and query key', async () => {
    const storage = new LocalStorageReplicaStorage<string[]>({ namespace: 'test' });

    await storage.set({ queryKey: 'limit:10', scope: 'scope-a' }, { data: ['a'], updatedAt: 1 });

    expect(localStorage.getItem('test:scope-a:limit%3A10')).toBe(
      JSON.stringify({ data: ['a'], updatedAt: 1 }),
    );
    await expect(storage.get({ queryKey: 'limit:10', scope: 'scope-b' })).resolves.toBeUndefined();
    await expect(storage.get({ queryKey: 'limit:50', scope: 'scope-a' })).resolves.toBeUndefined();
  });

  it('serializes through a custom codec', async () => {
    const codec = {
      parse: vi.fn((value: string) => ({ data: value.slice(4), updatedAt: 0 })),
      stringify: vi.fn(({ data }: { data: string }) => `raw:${data}`),
    };
    const storage = new LocalStorageReplicaStorage<string>({ codec, namespace: 'test' });
    const key = { queryKey: 'q', scope: 's' };

    await storage.set(key, { data: 'hello', updatedAt: 1 });

    await expect(storage.get(key)).resolves.toEqual({ data: 'hello', updatedAt: 0 });
  });

  it('rejects a write that did not land (quota), so the replica retries it', async () => {
    const storage = new LocalStorageReplicaStorage<string[]>({ namespace: 'test' });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await expect(
      storage.set({ queryKey: 'q', scope: 'user-a' }, { data: ['x'], updatedAt: 1 }),
    ).rejects.toThrow('QuotaExceededError');
  });

  it('reports a failed delete so the caller can retry it', async () => {
    const storage = new LocalStorageReplicaStorage<string[]>({ namespace: 'test' });
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    await expect(storage.remove({ queryKey: 'display', scope: 'user-a' })).rejects.toThrow(
      'access denied',
    );
  });

  it('rejects a strict read that failed, while get stays a cache miss', async () => {
    const storage = new LocalStorageReplicaStorage<string[]>({ namespace: 'test' });
    const key = { queryKey: '__replica:index', scope: 'user-a' };
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    await expect(storage.getStrict(key)).rejects.toThrow('access denied');
    await expect(storage.get(key)).resolves.toBeUndefined();
  });
});
