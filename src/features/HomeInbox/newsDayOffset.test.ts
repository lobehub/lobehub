import { describe, expect, it } from 'vitest';

import { resolveShownNewsOffset, shouldShowNewsItemTime } from './newsDayOffset';

describe('resolveShownNewsOffset', () => {
  it('maps the payload day to its offset from today', () => {
    const now = '2026-08-05T14:30:00';
    expect(resolveShownNewsOffset('2026-08-05', now)).toBe(0);
    expect(resolveShownNewsOffset('2026-08-04', now)).toBe(1);
    expect(resolveShownNewsOffset('2026-08-01', now)).toBe(4);
  });

  it('crosses month boundaries by calendar days, not by 24h buckets', () => {
    expect(resolveShownNewsOffset('2026-07-31', '2026-08-01T00:10:00')).toBe(1);
  });

  // The keepPreviousData race this helper exists for: a "today" payload still
  // on screen after local midnight must clamp to 0, not become "tomorrow".
  it('clamps a payload from a not-yet-refetched future day to today', () => {
    expect(resolveShownNewsOffset('2026-08-06', '2026-08-05T23:59:00')).toBe(0);
  });
});

describe('shouldShowNewsItemTime', () => {
  it('shows item time only for today', () => {
    expect(shouldShowNewsItemTime(0)).toBe(true);
    expect(shouldShowNewsItemTime(1)).toBe(false);
    expect(shouldShowNewsItemTime(30)).toBe(false);
  });
});
