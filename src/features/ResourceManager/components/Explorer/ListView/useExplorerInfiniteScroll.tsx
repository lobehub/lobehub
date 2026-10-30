import { useCallback, useState } from 'react';

import AsyncError from '@/components/AsyncError';
import { useFileStore } from '@/store/file';

import ListViewSkeleton from './Skeleton';

interface UseExplorerInfiniteScrollOptions {
  columnWidths: {
    date: number;
    name: number;
    size: number;
    uploader: number;
  };
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

  // The loader itself, without the guards: a manual retry has to run while the
  // recorded error is still set — the replica only clears it when the request
  // starts, so guarding on it here would make the Retry action a no-op.
  const runLoadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadNextPage();
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, loadNextPage]);

  const handleEndReached = useCallback(async () => {
    // Auto-loading stops on a failed page so scrolling cannot hammer it; the
    // footer's retry is the way back.
    if (loadMoreError) return;

    await runLoadMore();
  }, [loadMoreError, runLoadMore]);

  const retryLoadMore = useCallback(() => runLoadMore(), [runLoadMore]);

  const Footer = useCallback(() => {
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
  }, [columnWidths, dataLength, hasMore, isLoadingMore, loadMoreError, retryLoadMore, showUploader]);

  return {
    Footer,
    handleEndReached,
    retryLoadMore,
  };
};
