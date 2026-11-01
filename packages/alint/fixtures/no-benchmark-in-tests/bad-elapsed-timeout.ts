// Fixture: a timeout contract asserted by timing the real call.
import { describe, expect, it } from 'vitest';

import { flushScheduledWork } from '../scheduleAfterResponse';

describe('flushScheduledWork', () => {
  it('stops waiting at the timeout and leaves the work running', async () => {
    const startedAt = Date.now();
    const flushed = await flushScheduledWork({ timeoutMs: 10 });
    const elapsed = Date.now() - startedAt;

    expect(flushed).toBe(false);
    // alint-expect
    expect(elapsed).toBeLessThan(60);
  });
});
