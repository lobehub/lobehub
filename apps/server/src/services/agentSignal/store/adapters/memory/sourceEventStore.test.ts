import { afterEach, describe, expect, it, vi } from 'vitest';

import { inMemorySourceEventStore } from './sourceEventStore';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('inMemorySourceEventStore', () => {
  it('should preserve dedupe and scope locks until their TTL expires', async () => {
    vi.useFakeTimers();

    await expect(inMemorySourceEventStore.tryDedupe('event-1', 10)).resolves.toBe(true);
    await expect(inMemorySourceEventStore.tryDedupe('event-1', 10)).resolves.toBe(false);
    await expect(inMemorySourceEventStore.acquireScopeLock('scope-1', 10)).resolves.toBe(true);
    await expect(inMemorySourceEventStore.acquireScopeLock('scope-1', 10)).resolves.toBe(false);

    await vi.advanceTimersByTimeAsync(10_001);

    await expect(inMemorySourceEventStore.tryDedupe('event-1', 10)).resolves.toBe(true);
    await expect(inMemorySourceEventStore.acquireScopeLock('scope-1', 10)).resolves.toBe(true);
  });

  it('should copy window payloads and expire them', async () => {
    vi.useFakeTimers();
    const data = { count: '1' };

    await inMemorySourceEventStore.writeWindow('scope-2', data, 10);
    data.count = '2';

    await expect(inMemorySourceEventStore.readWindow('scope-2')).resolves.toEqual({ count: '1' });

    await vi.advanceTimersByTimeAsync(10_001);

    await expect(inMemorySourceEventStore.readWindow('scope-2')).resolves.toBeUndefined();
  });
});
