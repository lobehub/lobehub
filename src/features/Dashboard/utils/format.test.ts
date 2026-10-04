import { describe, expect, it } from 'vitest';

import { formatDelta, formatDuration, formatWidgetValue, truncateLog } from './format';

describe('dashboard format helpers', () => {
  it('passes string stat values through untouched', () => {
    expect(formatWidgetValue('N/A')).toBe('N/A');
    expect(formatWidgetValue('1.2k')).toBe('1.2k');
  });

  it('renders a missing value as empty, never as 0', () => {
    expect(formatWidgetValue(undefined)).toBe('');
    expect(formatWidgetValue(null)).toBe('');
    expect(formatWidgetValue(Number.NaN)).toBe('');
  });

  it('signs positive numeric deltas', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-2)).toBe('-2');
    expect(formatDelta('+5%')).toBe('+5%');
    expect(formatDelta(undefined)).toBeUndefined();
  });

  it('caps logs and says so', () => {
    expect(truncateLog('abc', 10)).toEqual({ text: 'abc', truncated: false });
    expect(truncateLog('abcdef', 3)).toEqual({ text: 'abc', truncated: true });
    expect(truncateLog(null)).toEqual({ text: '', truncated: false });
  });

  it('formats durations', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(2500)).toBe('2.5s');
    expect(formatDuration(null)).toBeUndefined();
  });
});
