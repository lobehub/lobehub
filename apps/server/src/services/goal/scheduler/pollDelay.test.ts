import { describe, expect, it } from 'vitest';

import { goalPollDelay } from './pollDelay';

const now = Date.parse('2026-11-09T00:00:00Z');
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

describe('goalPollDelay', () => {
  it.each([
    [0, 5],
    [50, 5],
    [120, 12],
    [300, 30],
    [600, 60],
    [86_400, 60],
  ])('after %ss without progress polls in %ss', (elapsed, delay) => {
    expect(goalPollDelay(ago(elapsed), now)).toBe(delay);
  });

  it('polls at the base rate when the start of the wait is unknown', () => {
    expect(goalPollDelay(undefined, now)).toBe(5);
    expect(goalPollDelay('not a date', now)).toBe(5);
  });
});
