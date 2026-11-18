import { describe, expect, it } from 'vitest';

import { clampToolIdentifier } from './clampToolIdentifier';

describe('tool identifier Unicode boundaries', () => {
  it('does not leave a lone surrogate when the database limit splits an emoji', () => {
    const input = `${'a'.repeat(254)}😀suffix`;
    const result = clampToolIdentifier(input);
    expect(result).toBe('a'.repeat(254));
    expect(result.isWellFormed()).toBe(true);
  });

  it('keeps a whole astral character that fits the limit', () => {
    const input = `${'a'.repeat(253)}😀suffix`;
    expect(clampToolIdentifier(input)).toBe(`${'a'.repeat(253)}😀`);
  });
});
