import type { DocumentCommentThreadPage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { partitionThreadPage } from '@/store/documentComment';

import { ANCHORED_EAGER_PAGE_LIMIT, getFeedPaginationState, shouldLoadEagerPage } from './hooks';

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

const feed = (overrides: Partial<Parameters<typeof shouldLoadEagerPage>[0] & object> = {}) => ({
  currentPage: 0,
  hasMore: true,
  items: [],
  pageSize: 50,
  ...overrides,
});

describe('shouldLoadEagerPage', () => {
  it('asks for one more page while under the budget', () => {
    expect(shouldLoadEagerPage(feed(), ANCHORED_EAGER_PAGE_LIMIT)).toBe(true);
    expect(
      shouldLoadEagerPage(
        feed({ currentPage: ANCHORED_EAGER_PAGE_LIMIT - 2 }),
        ANCHORED_EAGER_PAGE_LIMIT,
      ),
    ).toBe(true);
  });

  it('stops at the budget instead of draining every page', () => {
    expect(
      shouldLoadEagerPage(
        feed({ currentPage: ANCHORED_EAGER_PAGE_LIMIT - 1 }),
        ANCHORED_EAGER_PAGE_LIMIT,
      ),
    ).toBe(false);
  });

  it('never fetches ahead with a zero budget (the panel is closed or it is the document list)', () => {
    expect(shouldLoadEagerPage(feed(), 0)).toBe(false);
  });

  it('waits while a page is loading, stops on a failed page, and stops when exhausted', () => {
    expect(shouldLoadEagerPage(feed({ isLoadingMore: true }), 4)).toBe(false);
    expect(shouldLoadEagerPage(feed({ loadMoreError: new Error('x') }), 4)).toBe(false);
    expect(shouldLoadEagerPage(feed({ hasMore: false }), 4)).toBe(false);
    expect(shouldLoadEagerPage(undefined, 4)).toBe(false);
  });
});

describe('getFeedPaginationState', () => {
  it('shows a loading placeholder only while nothing has painted', () => {
    const state = { enabled: true, error: undefined, isValidating: true };
    expect(getFeedPaginationState(undefined, state).isLoadingInitial).toBe(true);
    // A feed hydrated from the replica paints at once, even while revalidating.
    expect(getFeedPaginationState(feed(), state).isLoadingInitial).toBe(false);
  });

  it('keeps a painted feed on a refresh failure and reports an initial error otherwise', () => {
    const state = { enabled: true, error: new Error('offline'), isValidating: false };
    expect(getFeedPaginationState(feed(), state)).toMatchObject({
      hasMore: false,
      isInitialError: false,
    });
    expect(getFeedPaginationState(undefined, state).isInitialError).toBe(true);
  });

  it('is idle while disabled', () => {
    expect(
      getFeedPaginationState(undefined, { enabled: false, error: undefined, isValidating: false })
        .isLoadingInitial,
    ).toBe(false);
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
