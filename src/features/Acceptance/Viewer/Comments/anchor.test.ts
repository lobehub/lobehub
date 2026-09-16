import { describe, expect, it } from 'vitest';

import { commentAnchorId, commentIdFromHash } from './anchor';

describe('comment anchors', () => {
  it('round-trips a comment id through the fragment', () => {
    const id = '9f1c2d3e-0000-4000-8000-000000000001';
    expect(commentIdFromHash(`#${commentAnchorId(id)}`)).toBe(id);
  });

  it('ignores fragments that address something else', () => {
    expect(commentIdFromHash('')).toBeUndefined();
    expect(commentIdFromHash('#')).toBeUndefined();
    // The page carries other fragments; only its own prefix may be claimed.
    expect(commentIdFromHash('#check-c2')).toBeUndefined();
    // A bare prefix names no comment.
    expect(commentIdFromHash('#comment-')).toBeUndefined();
  });
});
