import { describe, expect, it } from 'vitest';

import { formatTaskItemDate } from './formatTaskItemDate';

describe('formatTaskItemDate', () => {
  it('formats current-year dates with day precision', () => {
    expect(formatTaskItemDate('2026-04-24', { now: '2026-05-01' })).toBe('Apr 24');
  });

  it('formats dates from other years with the year included', () => {
    expect(formatTaskItemDate('2025-04-24', { now: '2026-05-01' })).toBe('Apr 24, 2025');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatTaskItemDate()).toBe('');
    expect(formatTaskItemDate('invalid date')).toBe('');
  });
});
