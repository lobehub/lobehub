import { describe, expect, it } from 'vitest';

import { findActiveSegment, formatClock } from './format';

describe('formatClock', () => {
  it('formats minutes and seconds, and hours from one hour on', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65_400)).toBe('01:05');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('clamps negative offsets to zero', () => {
    expect(formatClock(-500)).toBe('00:00');
  });
});

describe('findActiveSegment', () => {
  const segments = [
    { endMs: 4000, startMs: 0 },
    { endMs: 9000, startMs: 5000 },
    { endMs: 15_000, startMs: 9000 },
  ];

  it('finds the segment playing at an offset', () => {
    expect(findActiveSegment(segments, 0)).toBe(0);
    expect(findActiveSegment(segments, 6000)).toBe(1);
    expect(findActiveSegment(segments, 9000)).toBe(2);
  });

  it('highlights nothing in a gap, before the first or after the last segment', () => {
    expect(findActiveSegment(segments, 4500)).toBe(-1);
    expect(findActiveSegment(segments, 20_000)).toBe(-1);
    expect(findActiveSegment([], 1000)).toBe(-1);
  });
});
