import { useCallback, useState } from 'react';

import { useFileStore } from '@/store/file';

import ListViewSkeleton from './Skeleton';

interface UseExplorerInfiniteScrollOptions {
  columnWidths: {
    date: number;
    name: number;
    size: number;
  };
  dataLength: number;
  hasMore: boolean;
}

export const useExplorerInfiniteScroll = ({
  columnWidths,
  dataLength,
  hasMore,
}: UseExplorerInfiniteScrollOptions) => {
  const loadMoreResources = useFileStore((s) => s.loadMoreResources);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const handleEndReached = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadMoreResources();
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, loadMoreResources]);

  const Footer = useCallback(() => {
    if (isLoadingMore && hasMore) return <ListViewSkeleton columnWidths={columnWidths} />;
    if (hasMore === false && dataLength > 0) return <div aria-hidden style={{ height: 96 }} />;

    return null;
  }, [columnWidths, dataLength, hasMore, isLoadingMore]);

  return {
    Footer,
    handleEndReached,
  };
};
