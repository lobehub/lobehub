import { describe, expect, it } from 'vitest';

import { formatPercent, peakUsageLevel, usageLevel } from './format';

describe('device health formatters', () => {
  // The chart calls its formatter for every slot, including slots with no
  // samples — a null value used to crash the whole settings page.
  it('render a gap slot as a dash', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('format present values', () => {
    expect(formatPercent(41.6)).toBe('42%');
  });
});

describe('usage levels', () => {
  it('turns yellow from 70% and red from 90%', () => {
    expect(usageLevel(69.9)).toBe('normal');
    expect(usageLevel(70)).toBe('high');
    expect(usageLevel(89.9)).toBe('high');
    expect(usageLevel(90)).toBe('critical');
    expect(usageLevel(null)).toBeUndefined();
  });

  it('rates a block by its busiest metric', () => {
    expect(peakUsageLevel(40, 55, 93)).toBe('critical');
    expect(peakUsageLevel(null, 72, undefined)).toBe('high');
    expect(peakUsageLevel(null, undefined)).toBeUndefined();
  });
});
