import type { DocumentCommentThreadPage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { ANCHORED_EAGER_PAGE_LIMIT, nextEagerPageCount, partitionThreadPage } from './hooks';

const thread = (id: string, anchored: boolean) =>
  ({
    replyCount: 0,
    root: {
      id,
      selectionAnchor: anchored ? { end: 5, quote: 'hello', start: 0 } : null,
    },
  }) as unknown as DocumentCommentThreadPage['items'][number];

const mixedPage: DocumentCommentThreadPage = {
  items: [thread('a', true), thread('b', false), thread('c', true)],
  nextCursor: 'next',
};

describe('nextEagerPageCount', () => {
  it('requests one more page while under the budget', () => {
    expect(nextEagerPageCount(1, ANCHORED_EAGER_PAGE_LIMIT)).toBe(2);
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT - 1, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT,
    );
  });

  it('stops at the budget instead of draining every page', () => {
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT,
    );
    expect(nextEagerPageCount(ANCHORED_EAGER_PAGE_LIMIT + 3, ANCHORED_EAGER_PAGE_LIMIT)).toBe(
      ANCHORED_EAGER_PAGE_LIMIT + 3,
    );
  });

  it('never fetches ahead with a zero budget (the panel is closed or it is the document list)', () => {
    expect(nextEagerPageCount(1, 0)).toBe(1);
  });
});

describe('partitionThreadPage', () => {
  it('keeps only anchored roots for the anchored scope when the server returned a mixed page', () => {
    const page = partitionThreadPage(mixedPage, 'anchored');

    expect(page.items.map(({ root }) => root.id)).toEqual(['a', 'c']);
    expect(page.nextCursor).toBe('next');
  });

  it('keeps only document-level roots for the document scope', () => {
    expect(partitionThreadPage(mixedPage, 'document').items.map(({ root }) => root.id)).toEqual([
      'b',
    ]);
  });

  it('returns the page untouched for the all scope', () => {
    expect(partitionThreadPage(mixedPage, 'all')).toBe(mixedPage);
  });

  it('returns the same page object when the server already honoured the scope', () => {
    const anchoredOnly: DocumentCommentThreadPage = {
      items: [thread('a', true)],
      nextCursor: null,
    };

    expect(partitionThreadPage(anchoredOnly, 'anchored')).toBe(anchoredOnly);
  });
});
