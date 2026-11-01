import type { DocumentCommentAnchorItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { buildAnchorSignature } from './useDocumentCommentAnchors';

const anchor = (id: string, start: number, quote: string): DocumentCommentAnchorItem => ({
  id,
  selectionAnchor: { end: start + quote.length, quote, start },
});

describe('buildAnchorSignature', () => {
  it('produces the same signature for the same anchor set', () => {
    const anchors = [anchor('a', 0, 'hello'), anchor('b', 10, 'world')];

    expect(buildAnchorSignature(anchors)).toBe(buildAnchorSignature(anchors));
  });

  it('does not collide when concatenating id + start + quote would be ambiguous', () => {
    // "abc" + "1" + "22xyz" and "abc1" + "22" + "xyz" both concatenate to
    // "abc122xyz" with no delimiter — a real bug in an earlier version of
    // this function that made two different anchor sets look identical.
    const setX = [anchor('abc', 1, '22xyz')];
    const setY = [anchor('abc1', 22, 'xyz')];

    expect(buildAnchorSignature(setX)).not.toBe(buildAnchorSignature(setY));
  });

  it('does not collide across entries when a quote contains the join character', () => {
    // A quote containing a space (or any other single plain-character
    // delimiter) must not let two entries look like one merged entry.
    const merged = [anchor('a', 0, 'x y')];
    const split = [anchor('a', 0, 'x'), anchor('y', 0, '')];

    expect(buildAnchorSignature(merged)).not.toBe(buildAnchorSignature(split));
  });

  it('changes when any field of any entry changes', () => {
    const base = buildAnchorSignature([anchor('a', 0, 'hello')]);

    expect(buildAnchorSignature([anchor('a', 1, 'hello')])).not.toBe(base);
    expect(buildAnchorSignature([anchor('a', 0, 'hellp')])).not.toBe(base);
    expect(buildAnchorSignature([anchor('b', 0, 'hello')])).not.toBe(base);
  });
});
