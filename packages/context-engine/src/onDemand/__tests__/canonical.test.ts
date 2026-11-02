import { describe, expect, it } from 'vitest';

import { hashContent, stableStringify } from '../canonical';

describe('stable canonical serialization', () => {
  it('sorts object keys without reordering arrays', () => {
    const left = { b: 2, a: { d: 4, c: [3, 2, 1] } };
    const right = { a: { c: [3, 2, 1], d: 4 }, b: 2 };

    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(hashContent(left)).toBe(hashContent(right));
    expect(hashContent([1, 2])).not.toBe(hashContent([2, 1]));
  });

  it('ignores undefined object properties but preserves empty strings', () => {
    expect(stableStringify({ a: undefined, b: '' })).toBe('{"b":""}');
  });
});
