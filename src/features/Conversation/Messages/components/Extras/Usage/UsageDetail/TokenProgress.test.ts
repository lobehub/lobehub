import { describe, expect, it } from 'vitest';

import { formatToken } from './TokenProgress';

describe('formatToken', () => {
  it('formats token usage details with short units', () => {
    expect(formatToken(93_405)).toBe('93.4K');
    expect(formatToken(92_119)).toBe('92.1K');
    expect(formatToken(3_488)).toBe('3.5K');
    expect(formatToken(189_018)).toBe('189K');
  });

  it('keeps small token counts readable without suffixes', () => {
    expect(formatToken(0)).toBe('0');
    expect(formatToken(6)).toBe('6');
    expect(formatToken(999)).toBe('999');
  });

  it('formats million-level token counts with M suffix', () => {
    expect(formatToken(1_000_000)).toBe('1M');
    expect(formatToken(1_500_000)).toBe('1.5M');
  });
});
