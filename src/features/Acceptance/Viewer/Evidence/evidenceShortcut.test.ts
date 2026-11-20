import { describe, expect, it } from 'vitest';

import { evidenceShortcut } from './evidence';

describe('evidenceShortcut', () => {
  it('offers a region comment to a reader who may comment, even where the tap reviews', () => {
    expect(evidenceShortcut({ canComment: true, canMark: true, tapMarks: true })).toBe('comment');
    expect(evidenceShortcut({ canComment: true, canMark: false, tapMarks: false })).toBe('comment');
  });

  it('offers marking to the author on desktop', () => {
    expect(evidenceShortcut({ canComment: false, canMark: true, tapMarks: false })).toBe(
      'annotate',
    );
  });

  it('leaves the author no duplicate where tapping the picture already marks it', () => {
    expect(evidenceShortcut({ canComment: false, canMark: true, tapMarks: true })).toBeUndefined();
  });

  it('offers nothing when the viewer can neither comment nor mark', () => {
    expect(
      evidenceShortcut({ canComment: false, canMark: false, tapMarks: false }),
    ).toBeUndefined();
  });
});
