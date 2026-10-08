import { describe, expect, it, vi } from 'vitest';

import type { QueryProjectionStorage } from './types';
import { QueryProjectionWriteQueue } from './writeQueue';

describe('QueryProjectionWriteQueue', () => {
  it('serializes writes for the same projection key', async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    const calls: number[] = [];
    const storage: QueryProjectionStorage<number> = {
      get: vi.fn(),
      remove: vi.fn(),
      set: vi.fn(async (_key, projection) => {
        calls.push(projection.data);
        if (projection.data === 1) await first;
      }),
    };
    const queue = new QueryProjectionWriteQueue(storage);
    const key = { queryKey: 'list', scope: 'scope' };

    queue.set(key, { data: 1, updatedAt: 1 });
    queue.set(key, { data: 2, updatedAt: 2 });
    await vi.waitFor(() => expect(calls).toEqual([1]));

    releaseFirst();
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
  });
});
