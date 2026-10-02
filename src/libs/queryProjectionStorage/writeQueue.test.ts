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

  it('update reads after earlier queued writes and never recreates a removed row', async () => {
    const rows = new Map<string, { data: number; updatedAt: number }>();
    const storage: QueryProjectionStorage<number> = {
      get: async ({ queryKey }) => rows.get(queryKey),
      remove: async ({ queryKey }) => {
        rows.delete(queryKey);
      },
      set: async ({ queryKey }, projection) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        rows.set(queryKey, projection);
      },
    };
    const queue = new QueryProjectionWriteQueue(storage);
    const key = { queryKey: 'list', scope: 'scope' };
    const increment = (current?: { data: number }) =>
      current ? { data: current.data + 1, updatedAt: 2 } : undefined;

    queue.set(key, { data: 1, updatedAt: 1 });
    queue.update(key, increment);
    await vi.waitFor(() => expect(rows.get('list')?.data).toBe(2));

    queue.remove(key);
    queue.update(key, increment);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows.has('list')).toBe(false);
  });
});
