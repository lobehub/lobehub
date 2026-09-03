import { describe, expect, it } from 'vitest';

import { isMemoryHigh, sumLayoutShifts } from './metricUtils';

describe('DevDock metric utilities', () => {
  it('excludes layout shifts caused by recent user input', () => {
    expect(
      sumLayoutShifts([
        { hadRecentInput: false, value: 0.08 },
        { hadRecentInput: true, value: 0.2 },
        { hadRecentInput: false, value: 0.04 },
      ]),
    ).toBeCloseTo(0.12);
  });

  it('flags either a full JS heap or a 1 GiB renderer footprint', () => {
    expect(isMemoryHigh(90)).toBe(true);
    expect(isMemoryHigh(10, 1024 ** 3)).toBe(true);
    expect(isMemoryHigh(89, 1024 ** 3 - 1)).toBe(false);
  });
});
