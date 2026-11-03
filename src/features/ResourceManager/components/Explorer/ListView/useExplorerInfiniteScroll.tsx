import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import AsyncError from '@/components/AsyncError';
import { useFileStore } from '@/store/file';

import ListViewSkeleton from './Skeleton';

interface ColumnWidths {
  date: number;
  name: number;
  size: number;
  uploader: number;
}

interface UseExplorerInfiniteScrollOptions {
  columnWidths: ColumnWidths;
  dataLength: number;
  hasMore: boolean;
  /** Next-page loader; defaults to the folder list's. */
  loadMore?: () => Promise<void>;
  /**
   * Failure of a page past the head. The list stops auto-loading while it is
   * set, so scrolling cannot hammer a failing request, and the footer turns into
   * an explicit retry instead of a missing loading row.
   */
  loadMoreError?: unknown;
  showUploader?: boolean;
}

/** What the list footer renders from; handed to Virtuoso as its `context`. */
export interface ExplorerListFooterContext {
  columnWidths: ColumnWidths;
  dataLength: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError?: unknown;
  retryLoadMore: () => Promise<void>;
  showUploader: boolean;
}

/**
 * Module-level so its identity never changes: Virtuoso remounts a footer whose
 * component type changes, and a footer rebuilt on every page load made the
 * list height jump while scrolling. The state arrives through `context`.
 */
export const ExplorerListFooter = ({ context }: { context?: ExplorerListFooterContext }) => {
  if (!context) return null;

  const {
    columnWidths,
    dataLength,
    hasMore,
    isLoadingMore,
    loadMoreError,
    retryLoadMore,
    showUploader,
  } = context;

  if (loadMoreError)
    return (
      <AsyncError
        error={loadMoreError}
        retrying={isLoadingMore}
        variant={'inline'}
        onRetry={retryLoadMore}
      />
    );
  if (isLoadingMore && hasMore)
    return <ListViewSkeleton columnWidths={columnWidths} showUploader={showUploader} />;
  if (hasMore === false && dataLength > 0) return <div aria-hidden style={{ height: 96 }} />;

  return null;
};

export const useExplorerInfiniteScroll = ({
  columnWidths,
  dataLength,
  hasMore,
  loadMore,
  loadMoreError,
  showUploader = true,
}: UseExplorerInfiniteScrollOptions) => {
  const loadMoreResources = useFileStore((s) => s.loadMoreResources);
  const loadNextPage = loadMore ?? loadMoreResources;
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // The in-flight guard lives in a ref, not in render state: Virtuoso fires
  // `endReached` for the new last row as soon as a page lands, which is before
  // the `isLoadingMore` state from that load has been cleared. A state guard
  // dropped that call, and since Virtuoso does not repeat `endReached` for the
  // same row, a fast scroll stopped at the bottom with more pages unloaded.
  const inFlightRef = useRef(false);
  const reachedEndWhileLoadingRef = useRef(false);
  const latestRef = useRef({ hasMore, loadMoreError, loadNextPage });
  // Bumped when the end was reached mid-load; the follow-up load runs from an
  // effect, after the finished page (or its error) has been rendered.
  const [queuedLoad, setQueuedLoad] = useState(0);

  useLayoutEffect(() => {
    latestRef.current = { hasMore, loadMoreError, loadNextPage };
  });

  // The loader itself, without the error guard: a manual retry has to run while
  // the recorded error is still set — the replica only clears it when the
  // request starts, so guarding on it here would make the Retry action a no-op.
  // `queueIfBusy`: remember a request that arrives mid-load and run it after the
  // current page lands. Only the real end of the list queues; a prefetch hint
  // that arrives mid-load is already served by the page in flight.
  const runLoadMore = useCallback(async (queueIfBusy = true) => {
    if (inFlightRef.current) {
      if (queueIfBusy) reachedEndWhileLoadingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    setIsLoadingMore(true);
    reachedEndWhileLoadingRef.current = false;
    try {
      if (latestRef.current.hasMore) await latestRef.current.loadNextPage();
    } finally {
      inFlightRef.current = false;
      setIsLoadingMore(false);
      if (reachedEndWhileLoadingRef.current) {
        reachedEndWhileLoadingRef.current = false;
        setQueuedLoad((count) => count + 1);
      }
    }
  }, []);

  // Runs the queued load against the rendered outcome of the previous page: a
  // page that failed stops here (the footer's Retry takes over), and so does
  // the last page.
  useEffect(() => {
    if (queuedLoad === 0) return;

    const { hasMore: canLoadMore, loadMoreError: pageError } = latestRef.current;
    if (pageError || !canLoadMore) return;

    void runLoadMore();
  }, [queuedLoad, runLoadMore]);

  const handleEndReached = useCallback(async () => {
    // Auto-loading stops on a failed page so scrolling cannot hammer it; the
    // footer's retry is the way back.
    if (loadMoreError) return;

    await runLoadMore();
  }, [loadMoreError, runLoadMore]);

  /** Load the next page ahead of the end; never queues behind a page in flight. */
  const prefetchMore = useCallback(async () => {
    if (loadMoreError) return;

    await runLoadMore(false);
  }, [loadMoreError, runLoadMore]);

  const retryLoadMore = useCallback(() => runLoadMore(), [runLoadMore]);

  const footerContext = useMemo<ExplorerListFooterContext>(
    () => ({
      columnWidths,
      dataLength,
      hasMore,
      isLoadingMore,
      loadMoreError,
      retryLoadMore,
      showUploader,
    }),
    [columnWidths, dataLength, hasMore, isLoadingMore, loadMoreError, retryLoadMore, showUploader],
  );

  return {
    footerContext,
    handleEndReached,
    prefetchMore,
    retryLoadMore,
  };
};
