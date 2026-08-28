import { describe, expect, it } from 'vitest';

import { truncateSurrogateSafe } from '../truncateSurrogateSafe';

describe('truncateSurrogateSafe', () => {
  it('truncates plain text to maxLength', () => {
    expect(truncateSurrogateSafe('a'.repeat(300), 200)).toBe('a'.repeat(200));
  });

  it('returns short strings unchanged', () => {
    expect(truncateSurrogateSafe('hello 😀', 200)).toBe('hello 😀');
  });

  it('drops the lone high surrogate when the cut splits an emoji', () => {
    const result = truncateSurrogateSafe(`${'a'.repeat(199)}😀tail`, 200);

    expect(result).toBe('a'.repeat(199));
    // no surrogate code unit survives, so a JSON/jsonb write cannot be rejected
    expect(result).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it('keeps a surrogate pair that fits exactly at the boundary', () => {
    // the emoji occupies code units 198–199, so the cut lands after the pair
    expect(truncateSurrogateSafe(`${'a'.repeat(198)}😀tail`, 200)).toBe(`${'a'.repeat(198)}😀`);
  });

  it('trims a pre-existing trailing lone high surrogate on short input', () => {
    expect(truncateSurrogateSafe('abc\uD83D', 200)).toBe('abc');
  });

  it('handles empty strings', () => {
    expect(truncateSurrogateSafe('', 10)).toBe('');
  });
});
