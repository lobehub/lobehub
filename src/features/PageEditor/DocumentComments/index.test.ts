import { describe, expect, it } from 'vitest';

import { resolveListThreadFocus } from './index';
import type { DocumentCommentFocus } from './useDocumentCommentDeepLink';

const focus: DocumentCommentFocus = {
  commentId: 'root-1',
  rootCommentId: 'root-1',
  scroll: true,
  token: 1,
};

describe('resolveListThreadFocus', () => {
  it('returns undefined for a root the focus does not target', () => {
    expect(resolveListThreadFocus(focus, new Set(), 'root-2')).toBeUndefined();
  });

  it('returns undefined when there is no focus at all', () => {
    expect(resolveListThreadFocus(undefined, new Set(['root-1']), 'root-1')).toBeUndefined();
  });

  it('passes the focus through unchanged when the gutter has no copy of this thread', () => {
    expect(resolveListThreadFocus(focus, new Set(), 'root-1')).toEqual(focus);
  });

  it('suppresses the scroll when the gutter already shows this thread', () => {
    expect(resolveListThreadFocus(focus, new Set(['root-1']), 'root-1')).toEqual({
      ...focus,
      scroll: false,
    });
  });

  it("leaves an in-body pick's focus (scroll already false) as-is when duplicated in the gutter", () => {
    const pick = { ...focus, scroll: false };

    expect(resolveListThreadFocus(pick, new Set(['root-1']), 'root-1')).toEqual(pick);
  });
});
