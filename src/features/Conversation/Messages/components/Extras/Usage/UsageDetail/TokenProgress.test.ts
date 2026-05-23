import { describe, expect, it } from 'vitest';

import { formatUsageValue } from './TokenProgress';

describe('formatUsageValue', () => {
  it('formats token usage details with short units', () => {
    expect(formatUsageValue(93_405)).toBe('93.4K');
    expect(formatUsageValue(92_119)).toBe('92.1K');
    expect(formatUsageValue(3_488)).toBe('3.5K');
    expect(formatUsageValue(189_018)).toBe('189K');
  });

  it('formats credit usage details with the same short units', () => {
    expect(formatUsageValue(16_127)).toBe('16.1K');
    expect(formatUsageValue(16_179)).toBe('16.2K');
  });

  it('keeps small token counts readable without suffixes', () => {
    expect(formatUsageValue(0)).toBe('0');
    expect(formatUsageValue(6)).toBe('6');
    expect(formatUsageValue(999)).toBe('999');
  });

  it('formats million-level token counts with M suffix', () => {
    expect(formatUsageValue(1_000_000)).toBe('1M');
    expect(formatUsageValue(1_500_000)).toBe('1.5M');
  });
});
