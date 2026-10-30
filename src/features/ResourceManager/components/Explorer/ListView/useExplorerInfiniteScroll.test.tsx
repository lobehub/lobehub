import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useExplorerInfiniteScroll } from './useExplorerInfiniteScroll';

const columnWidths = { date: 100, name: 200, size: 80, uploader: 80 };
const failedPage = new Error('page 2 failed');

describe('useExplorerInfiniteScroll', () => {
  // Auto-loading must stop on a failed page, otherwise every scroll frame
  // re-issues the request that just failed.
  it('should stop auto-loading while the next page is in error', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplorerInfiniteScroll({
        columnWidths,
        dataLength: 2,
        hasMore: true,
        loadMore,
        loadMoreError: failedPage,
      }),
    );

    await act(() => result.current.handleEndReached());

    expect(loadMore).not.toHaveBeenCalled();
  });

  // Regression: the retry path went through the guarded handler, so the Retry
  // action on the failed footer did nothing at all.
  it('should let an explicit retry through the error guard', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplorerInfiniteScroll({
        columnWidths,
        dataLength: 2,
        hasMore: true,
        loadMore,
        loadMoreError: failedPage,
      }),
    );

    await act(async () => {
      await result.current.retryLoadMore();
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
