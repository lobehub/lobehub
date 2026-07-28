import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExpiringMap } from './expiringMap';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('ExpiringMap', () => {
  it('should actively prune unique expired keys without another read', async () => {
    vi.useFakeTimers();
    const entries = new ExpiringMap<string>();

    entries.set('unique-1', 'one', 10_000);
    entries.set('unique-2', 'two', 20_000);
    expect(entries.size).toBe(2);

    await vi.advanceTimersByTimeAsync(10_001);
    expect(entries.size).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(entries.size).toBe(0);
  });
});
