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

  it('treats persistence failures as a cache miss', async () => {
    vi.spyOn(localDatabase, 'initialize').mockRejectedValue(new Error('unavailable'));
    const storage = new IndexedDBQueryProjectionStorage<string[]>({ namespace: 'projects' });

    await expect(storage.get({ queryKey: 'all', scope: 'personal' })).resolves.toBeUndefined();
  });
});
