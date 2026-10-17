import { describe, expect, it } from 'vitest';

import { autoLoadMoreProps, canAutoLoadMore, resolveLoadMoreFooter } from './loadMoreFooterState';

describe('resolveLoadMoreFooter', () => {
  it('shows the loading rows while a page is in flight', () => {
    expect(resolveLoadMoreFooter({ isLoading: true })).toBe('loading');
    expect(resolveLoadMoreFooter({ isLoading: true, loadMoreError: new Error('x') })).toBe(
      'loading',
    );
  });

  it('shows the failure of the last page so it can be retried', () => {
    expect(resolveLoadMoreFooter({ loadMoreError: new Error('offline') })).toBe('error');
  });

  it('renders nothing once every page settled', () => {
    expect(resolveLoadMoreFooter({})).toBeUndefined();
  });
});

describe('canAutoLoadMore', () => {
  it('requests the next page at the end of the list while there is more', () => {
    expect(canAutoLoadMore({ hasMore: true })).toBe(true);
    expect(canAutoLoadMore({ hasMore: false })).toBe(false);
  });

  it('waits for an explicit retry after a failed page', () => {
    expect(canAutoLoadMore({ hasMore: true, loadMoreError: new Error('offline') })).toBe(false);
  });
});

describe('autoLoadMoreProps', () => {
  const onLoadMore = () => {};

  // Virtuoso re-fires endReached only when [lastIndex, data] changes: after a
  // delete collapses two loaded pages back to the head page, the end index is
  // the one the head page already reported, so the trigger must be keyed on the
  // rendered page set or the next page is never requested again.
  it('keys the end-of-list trigger on the rendered page set', () => {
    const headPage = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}` }));
    const collapsedHead = headPage.filter((row) => row.id !== 'r5').concat({ id: 'r12' });

    const before = autoLoadMoreProps({ hasMore: true, items: headPage, onLoadMore });
    const after = autoLoadMoreProps({ hasMore: true, items: collapsedHead, onLoadMore });

    expect(before.data).toBe(headPage);
    expect(after.data).toBe(collapsedHead);
    expect(after.data.length - 1).toBe(before.data.length - 1);
    expect(after.data).not.toBe(before.data);
    expect(after.endReached).toBe(onLoadMore);
  });

  it('disarms the trigger when there is nothing more or the last page failed', () => {
    expect(autoLoadMoreProps({ hasMore: false, items: [], onLoadMore }).endReached).toBeUndefined();
    expect(
      autoLoadMoreProps({ hasMore: true, items: [], loadMoreError: new Error('x'), onLoadMore })
        .endReached,
    ).toBeUndefined();
  });
});
