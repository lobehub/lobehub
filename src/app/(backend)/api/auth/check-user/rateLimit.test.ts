import { beforeEach, describe, expect, it } from 'vitest';

import { consumeCheckUserRateLimit, resetCheckUserRateLimitForTests } from './rateLimit';

describe('consumeCheckUserRateLimit (AUTH-001)', () => {
  beforeEach(() => {
    resetCheckUserRateLimitForTests();
  });

  it('allows requests under the max within the window', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(consumeCheckUserRateLimit('ip-a', { max: 10, windowMs: 60_000 })).toBe(true);
    }
  });

  it('blocks the request once the max is exceeded', () => {
    for (let i = 0; i < 10; i += 1) {
      consumeCheckUserRateLimit('ip-b', { max: 10, windowMs: 60_000 });
    }
    expect(consumeCheckUserRateLimit('ip-b', { max: 10, windowMs: 60_000 })).toBe(false);
  });

  it('isolates counters per client key', () => {
    for (let i = 0; i < 10; i += 1) {
      consumeCheckUserRateLimit('ip-c', { max: 10, windowMs: 60_000 });
    }
    expect(consumeCheckUserRateLimit('ip-d', { max: 10, windowMs: 60_000 })).toBe(true);
  });
});
