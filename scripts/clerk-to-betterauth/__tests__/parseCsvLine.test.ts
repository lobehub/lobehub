import { describe, expect, it } from 'vitest';

import { parseCsvLine } from '../_internal/load-data-from-files';

describe('parseCsvLine', () => {
  it('parses simple comma separated values', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted commas', () => {
    expect(parseCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });

  it('handles escaped quotes inside quoted field', () => {
    expect(parseCsvLine('"a""b",c')).toEqual(['a"b', 'c']);
  });

  it('handles trailing empty fields', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });
});
