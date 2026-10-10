// Fixture carve-out: a timeout contract driven by a fake clock, not a real one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushScheduledWork } from '../scheduleAfterResponse';

describe('flushScheduledWork', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops waiting at the timeout', async () => {
    const flushed = flushScheduledWork({ timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(10);

    await expect(flushed).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
