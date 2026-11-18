import { afterEach, describe, expect, it, vi } from 'vitest';

import { nextScheduleFiring } from './helpers';

const timezone = 'America/New_York';

describe('nextScheduleFiring for daily schedules', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['spring forward', '0 9 * * *', '2026-03-08T01:00:00Z', '2026-03-08T13:00:00.000Z'],
    ['fall back', '0 9 * * *', '2026-11-01T00:00:00Z', '2026-11-01T14:00:00.000Z'],
    ['an ordinary day', '0 9 * * *', '2026-11-02T01:00:00Z', '2026-11-02T14:00:00.000Z'],
    ['a skipped time', '30 2 * * *', '2026-03-08T01:00:00Z', '2026-03-09T06:30:00.000Z'],
    ['the first repeated time', '30 1 * * *', '2026-11-01T00:00:00Z', '2026-11-01T05:30:00.000Z'],
    ['the second repeated time', '30 1 * * *', '2026-11-01T05:40:00Z', '2026-11-01T06:30:00.000Z'],
  ])('finds the next occurrence across %s', (_, pattern, now, expected) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));

    expect(nextScheduleFiring(pattern, timezone)?.toISOString()).toBe(expected);
  });
});
