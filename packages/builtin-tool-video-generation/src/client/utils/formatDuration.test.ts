import { describe, expect, it } from 'vitest';

import { formatDuration } from './formatDuration';

describe('formatDuration', () => {
  it.each([
    [500, '1s'],
    [59_000, '59s'],
    [60_000, '1m'],
    [75_700, '1m 16s'],
  ])('formats %i milliseconds as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});
