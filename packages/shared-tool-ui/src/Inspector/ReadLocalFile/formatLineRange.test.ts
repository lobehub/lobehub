import { describe, expect, it } from 'vitest';

import { formatReadLineRange } from './formatLineRange';

describe('formatReadLineRange', () => {
  it('shifts the builtin 0-based, end-exclusive loc to 1-based lines', () => {
    expect(formatReadLineRange({ loc: [160, 181] })).toBe('L161-L181');
    expect(formatReadLineRange({ loc: [0, 200] })).toBe('L1-L200');
  });

  it('keeps 1-based startLine / endLine as-is', () => {
    expect(formatReadLineRange({ endLine: 20, startLine: 10 })).toBe('L10-L20');
  });

  it('derives the end from a 1-based offset and limit', () => {
    expect(formatReadLineRange({ limit: 10, offset: 5 })).toBe('L5-L14');
    expect(formatReadLineRange({ offset: 5 })).toBe('L5');
  });

  it('returns nothing without a range', () => {
    expect(formatReadLineRange({})).toBeUndefined();
    expect(formatReadLineRange()).toBeUndefined();
  });
});
