import { afterEach, describe, expect, it } from 'vitest';

import { LocalStorageQueryProjectionStorage } from './localStorage';

afterEach(() => {
  localStorage.clear();
});

describe('LocalStorageQueryProjectionStorage', () => {
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
});
