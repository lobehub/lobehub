import { beforeEach, describe, expect, it, vi } from 'vitest';

import { localDatabase } from '@/libs/localDatabase';

import { IndexedDBQueryProjectionStorage } from './indexedDB';

describe('IndexedDBQueryProjectionStorage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses one scoped row per query projection', async () => {
    vi.spyOn(localDatabase, 'initialize').mockResolvedValue();
    const set = vi.spyOn(localDatabase, 'set').mockResolvedValue();
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });
    const key = { queryKey: 'detail:1', scope: 'user:workspace' };

    await storage.set(key, { data: ['cached'], updatedAt: 1 });

    expect(set).toHaveBeenCalledWith('query-projections', 'projects:user%3Aworkspace:detail%3A1', {
      data: ['cached'],
      updatedAt: 1,
    });
  });

  it('rejects a write that did not land, so the replica retries it', async () => {
    vi.spyOn(localDatabase, 'initialize').mockResolvedValue();
    vi.spyOn(localDatabase, 'set').mockRejectedValue(new Error('transaction aborted'));
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });

    await expect(
      storage.set({ queryKey: 'all', scope: 'personal' }, { data: ['x'], updatedAt: 1 }),
    ).rejects.toThrow('transaction aborted');
  });

  it('treats persistence failures as a cache miss', async () => {
    vi.spyOn(localDatabase, 'initialize').mockRejectedValue(new Error('unavailable'));
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });

    await expect(storage.get({ queryKey: 'all', scope: 'personal' })).resolves.toBeUndefined();
  });

  it('reports a failed delete so the caller can retry it', async () => {
    vi.spyOn(localDatabase, 'initialize').mockResolvedValue();
    vi.spyOn(localDatabase, 'delete').mockRejectedValue(new Error('database closed'));
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });

    await expect(storage.remove({ queryKey: 'all', scope: 'personal' })).rejects.toThrow(
      'database closed',
    );
  });

  it('rejects a strict read that failed, while get stays a cache miss', async () => {
    vi.spyOn(localDatabase, 'initialize').mockResolvedValue();
    vi.spyOn(localDatabase, 'get').mockRejectedValue(new Error('database closed'));
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });
    const key = { queryKey: '__replica:index', scope: 'personal' };

    await expect(storage.getStrict(key)).rejects.toThrow('database closed');
    await expect(storage.get(key)).resolves.toBeUndefined();
  });
});
