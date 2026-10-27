import { describe, expect, it } from 'vitest';

import { formatValue, heatmapLevel } from './format';

describe('formatValue', () => {
  it('formats by the requested style and appends the unit', () => {
    expect(formatValue(1234.567)).toBe(
      new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(1234.567),
    );
    expect(formatValue(0.25, 'percent')).toContain('25');
    expect(formatValue(25, 'percent')).toContain('25');
    expect(formatValue(10, 'currency')).toBe('$10');
    expect(formatValue(120, undefined, 'ms')).toBe('120 ms');
    expect(formatValue('n/a')).toBe('n/a');
  });

  it('attaches symbol units without a space', () => {
    expect(formatValue(40, undefined, '%')).toBe('40%');
    expect(formatValue(3, undefined, '‰')).toBe('3‰');
    expect(formatValue(12, undefined, '万')).toBe('12 万');
  });
});

describe('heatmapLevel', () => {
  it('maps counts onto five levels', () => {
    expect(heatmapLevel(0, 10)).toBe(0);
    expect(heatmapLevel(1, 10)).toBe(1);
    expect(heatmapLevel(10, 10)).toBe(4);
  });
});
