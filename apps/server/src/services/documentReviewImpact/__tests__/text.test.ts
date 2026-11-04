// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildAnchor } from '../text';

const hasLoneSurrogate = (value: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

describe('buildAnchor context slices', () => {
  it('keeps the prefix on whole code points when an emoji straddles the cut', () => {
    // The 40-unit window starts on the low surrogate of the emoji: a bare
    // `slice` would keep it, and the jsonb column rejects that lone surrogate
    // when the anchor is saved.
    const anchor = buildAnchor(`${'a'.repeat(39)}😀${'a'.repeat(39)}QUOTE`, 'QUOTE');

    expect(hasLoneSurrogate(anchor!.prefix!)).toBe(false);
    expect(anchor!.prefix).toBe('a'.repeat(39));
  });

  it('drops a pair that would be split at the end of the suffix', () => {
    const anchor = buildAnchor(`QUOTE${'a'.repeat(39)}😀tail`, 'QUOTE');

    expect(hasLoneSurrogate(anchor!.suffix!)).toBe(false);
    expect(anchor!.suffix).toBe('a'.repeat(39));
  });

  it('leaves the quote itself untouched', () => {
    const anchor = buildAnchor('前言 😀QUOTE😀 后记', 'QUOTE');

    expect(anchor).toMatchObject({ quote: 'QUOTE' });
    expect(anchor!.prefix).toBe('前言 😀');
    expect(anchor!.suffix).toBe('😀 后记');
  });
});
