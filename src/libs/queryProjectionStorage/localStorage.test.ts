import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalStorageQueryProjectionStorage } from './localStorage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('LocalStorageQueryProjectionStorage', () => {
  it('restores a scoped projection synchronously before the next paint', () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });
    const key = { queryKey: 'display', scope: 'user-a' };

    void storage.set(key, { data: ['cached'], updatedAt: 1 });

    expect(storage.getSync(key)).toEqual({ data: ['cached'], updatedAt: 1 });
    expect(storage.getSync({ ...key, scope: 'user-b' })).toBeUndefined();
  });

  it('rejects a write that did not land (quota), so the replica retries it', async () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await expect(
      storage.set({ queryKey: 'q', scope: 'user-a' }, { data: ['x'], updatedAt: 1 }),
    ).rejects.toThrow('QuotaExceededError');
  });

  it('reads and writes one scoped query through the async interface', async () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });
    const key = { queryKey: 'limit:10', scope: 'user:workspace' };

    await storage.set(key, { data: ['cached'], updatedAt: 1 });

    await expect(storage.get(key)).resolves.toEqual({ data: ['cached'], updatedAt: 1 });
  });

  it('isolates projections by scope and query key', async () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });

    await storage.set({ queryKey: 'limit:10', scope: 'scope-a' }, { data: ['a'], updatedAt: 1 });

    await expect(storage.get({ queryKey: 'limit:10', scope: 'scope-b' })).resolves.toBeUndefined();
    await expect(storage.get({ queryKey: 'limit:50', scope: 'scope-a' })).resolves.toBeUndefined();
  });

  it('preserves rich data types with the default codec', async () => {
    const storage = new LocalStorageQueryProjectionStorage<{ createdAt: Date }>({
      namespace: 'test',
    });
    const key = { queryKey: 'detail:1', scope: 'scope' };

    await storage.set(key, { data: { createdAt: new Date(0) }, updatedAt: 1 });

    expect((await storage.get(key))?.data.createdAt).toEqual(new Date(0));
  });

  it('reports a failed delete so the caller can retry it', async () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    await expect(storage.remove({ queryKey: 'display', scope: 'user-a' })).rejects.toThrow(
      'access denied',
    );
  });

  it('rejects a strict read that failed, while get stays a cache miss', async () => {
    const storage = new LocalStorageQueryProjectionStorage<string[]>({ namespace: 'test' });
    const key = { queryKey: '__replica:index', scope: 'user-a' };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });

    await expect(storage.getStrict(key)).rejects.toThrow('access denied');
    await expect(storage.get(key)).resolves.toBeUndefined();
  });
});
