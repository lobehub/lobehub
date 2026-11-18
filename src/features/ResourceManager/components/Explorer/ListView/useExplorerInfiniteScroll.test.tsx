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

  // Regression: Virtuoso fires `endReached` for the new last row while the
  // previous page is still settling. The old state-based guard dropped that
  // call, and Virtuoso never repeats it for the same row, so a fast scroll got
  // stuck at the bottom with more pages unloaded.
  it('should load again when the end is reached while a page is in flight', async () => {
    let resolvePage!: () => void;
    const loadMore = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolvePage = resolve)))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplorerInfiniteScroll({ columnWidths, dataLength: 50, hasMore: true, loadMore }),
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.handleEndReached();
    });
    await act(() => result.current.handleEndReached());
    expect(loadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePage();
      await first;
    });

    expect(loadMore).toHaveBeenCalledTimes(2);
    expect(result.current.footerContext.isLoadingMore).toBe(false);
  });

  // Regression: a page that failed while the end was reached again must stop
  // at the Retry footer instead of retrying on its own.
  it('should not run a queued load after the page in flight failed', async () => {
    let resolvePage!: () => void;
    const loadMore = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolvePage = resolve)))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ loadMoreError }: { loadMoreError?: unknown }) =>
        useExplorerInfiniteScroll({
          columnWidths,
          dataLength: 50,
          hasMore: true,
          loadMore,
          loadMoreError,
        }),
      { initialProps: {} as { loadMoreError?: unknown } },
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.handleEndReached();
    });
    await act(() => result.current.handleEndReached());

    // The pager records the failure and resolves the request.
    await act(async () => {
      rerender({ loadMoreError: failedPage });
      resolvePage();
      await first;
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('should not queue a prefetch behind a page in flight', async () => {
    let resolvePage!: () => void;
    const loadMore = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (resolvePage = resolve)))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplorerInfiniteScroll({ columnWidths, dataLength: 50, hasMore: true, loadMore }),
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.prefetchMore();
    });
    await act(() => result.current.prefetchMore());

    await act(async () => {
      resolvePage();
      await first;
    });

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('should not load when there are no more pages', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useExplorerInfiniteScroll({ columnWidths, dataLength: 50, hasMore: false, loadMore }),
    );

    await act(() => result.current.handleEndReached());

    expect(loadMore).not.toHaveBeenCalled();
  });
});
