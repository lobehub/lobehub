import { afterEach, describe, expect, it, vi } from 'vitest';

import { localDatabase } from '@/libs/localDatabase';
import type { RecentItem } from '@/server/routers/lambda/recent';

import { recentQueryRepository } from './repository';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recentQueryRepository', () => {
  it('persists one query projection under its scope and query key', async () => {
    const setSpy = vi.spyOn(localDatabase, 'set').mockResolvedValue();
    const items = [{ id: 'a', title: 'A', type: 'task' }] as RecentItem[];

    await recentQueryRepository.set('user-1:ws-A', 'limit:11', items);

    expect(setSpy).toHaveBeenCalledWith(
      'home-recent-query',
      'user-1:ws-A::limit:11',
      expect.objectContaining({ items, version: 1 }),
    );
  });

  it('ignores a persisted projection from an unsupported version', async () => {
    vi.spyOn(localDatabase, 'get').mockResolvedValue({ items: [], updatedAt: 1, version: 0 });

    await expect(recentQueryRepository.get('user-1:ws-A', 'limit:11')).resolves.toBeUndefined();
  });
});
