import { describe, expect, it } from 'vitest';

import { formatToken } from './TokenProgress';

describe('formatToken', () => {
  it('should format numbers >= 1M with M suffix', () => {
    expect(formatToken(1_000_000)).toBe('1M');
    expect(formatToken(1_500_000)).toBe('1.5M');
    expect(formatToken(2_000_000)).toBe('2M');
    expect(formatToken(10_000_000)).toBe('10M');
  });

  it('should format numbers >= 1K with K suffix', () => {
    expect(formatToken(1_000)).toBe('1K');
    expect(formatToken(14_251)).toBe('14.3K');
    expect(formatToken(985_749)).toBe('985.7K');
    expect(formatToken(999_999)).toBe('1000K');
  });

  it('should format numbers < 1K with comma separator', () => {
    expect(formatToken(0)).toBe('0');
    expect(formatToken(1)).toBe('1');
    expect(formatToken(999)).toBe('999');
  });
});
