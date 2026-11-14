import { describe, expect, it } from 'vitest';

import { formatPercent, LOAD_THRESHOLDS, peakUsageLevel, usageLevel } from './format';

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
  it('turns yellow from 80% and red from 95%', () => {
    expect(usageLevel(79.9)).toBe('normal');
    expect(usageLevel(80)).toBe('high');
    expect(usageLevel(94.9)).toBe('high');
    expect(usageLevel(95)).toBe('critical');
    expect(usageLevel(null)).toBeUndefined();
  });

  it('rates load per core: yellow above the core count, red only at twice it', () => {
    expect(usageLevel(99.9, LOAD_THRESHOLDS)).toBe('normal');
    expect(usageLevel(129, LOAD_THRESHOLDS)).toBe('high');
    expect(usageLevel(199.9, LOAD_THRESHOLDS)).toBe('high');
    expect(usageLevel(200, LOAD_THRESHOLDS)).toBe('critical');
  });

  it('rates a block by its hottest level', () => {
    expect(peakUsageLevel('normal', 'normal', 'critical')).toBe('critical');
    expect(peakUsageLevel(undefined, 'high', 'normal')).toBe('high');
    expect(peakUsageLevel(undefined, undefined)).toBeUndefined();
  });
});
