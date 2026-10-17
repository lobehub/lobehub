import { describe, expect, it } from 'vitest';

import { litSegments, segmentCount } from './UsageMeter';

describe('segmentCount', () => {
  it('fits whole 3px ticks with 1px gaps', () => {
    expect(segmentCount(0)).toBe(0);
    expect(segmentCount(3)).toBe(1);
    expect(segmentCount(159)).toBe(40);
    expect(segmentCount(161)).toBe(40);
  });
});

describe('litSegments', () => {
  it('lights nothing without a reading, at zero, or before the bar is measured', () => {
    expect(litSegments(undefined, 40)).toBe(0);
    expect(litSegments(null, 40)).toBe(0);
    expect(litSegments(0, 40)).toBe(0);
    expect(litSegments(50, 0)).toBe(0);
  });

  it('lights at least one tick for any non-zero usage', () => {
    expect(litSegments(0.5, 40)).toBe(1);
  });

  it('scales to the segment count and clamps overload', () => {
    expect(litSegments(50, 40)).toBe(20);
    expect(litSegments(150, 40)).toBe(40);
  });
});
