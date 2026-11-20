import { describe, expect, it } from 'vitest';

import { formatImageRef, stripImageRefs } from './imageRef';

describe('stripImageRefs', () => {
  it('removes every reference written by formatImageRef with its trailing space', () => {
    const text = `${formatImageRef(1)} ${formatImageRef(2)} compare these logos`;

    expect(stripImageRefs(text)).toBe('compare these logos');
  });

  it('keeps text that only looks similar', () => {
    expect(stripImageRefs('see [Image] and Image #3')).toBe('see [Image] and Image #3');
  });
});
