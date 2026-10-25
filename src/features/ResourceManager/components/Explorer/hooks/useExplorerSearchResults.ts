import { useCallback, useMemo } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { explorerSearchResource } from '@/features/ResourceManager/store/projection';
import { getExplorerSearchParams } from '@/features/ResourceManager/store/selectors';
import type { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

/**
 * Rows of the explorer's search overlay, or `searchParams: null` while no
 * keyword is typed.
 *
 * Search results are a `@lobechat/replica` entry owned by the ResourceManager
 * store: the head page is persisted, so re-opening a search paints the rows it
 * had before the request lands. The keyword is part of the query identity, so
 * the painted rows are only used while they still answer the request on screen.
 */
export const useExplorerSearchResults = () => {
  const searchParams = useResourceManagerStore(getExplorerSearchParams);
  const loadMoreExplorerSearch = useResourceManagerStore((s) => s.loadMoreExplorerSearch);
  const { error, revalidate } = useResourceManagerStore((s) => s.useFetchExplorerSearch)(
    searchParams,
  );

  // One entry per query: the entry key IS the query identity, so the rows read
  // here always answer the request on screen.
  const searchKey = searchParams ? explorerSearchResource.key(searchParams) : undefined;
  const current = useResourceManagerStore((s) =>
    searchKey ? s.explorerSearchEntries[searchKey] : undefined,
  );

  const rawData = current?.items;
  const data: FileListItem[] = useMemo(
    () =>
      rawData?.map((item) => ({
        ...item,
        chunkCount: item.chunkCount ?? null,
        chunkingError: item.chunkingError ?? null,
        chunkingStatus: (item.chunkingStatus ?? null) as AsyncTaskStatus | null,
        embeddingError: item.embeddingError ?? null,
        embeddingStatus: (item.embeddingStatus ?? null) as AsyncTaskStatus | null,
        finishEmbedding: item.finishEmbedding ?? false,
        url: item.url ?? '',
      })) ?? [],
    [rawData],
  );

  // Hits beyond the first page used to be unreachable: the overlay never asked
  // for the next page, so a keyword matching hundreds of files showed 50.
  const loadMore = useCallback(async () => {
    if (searchKey) await loadMoreExplorerSearch(searchKey);
  }, [loadMoreExplorerSearch, searchKey]);

  return {
    data,
    error,
    hasMore: current?.hasMore ?? false,
    isLoading: !!searchParams && !current && !error,
    isLoadingMore: current?.isLoadingMore ?? false,
    loadMore,
    // A page past the head can fail on its own; the head error never covers it.
    // Returning it lets the overlay stop scrolling into the failure and offer a
    // retry at the tail instead of silently dropping the remaining rows.
    loadMoreError: current?.loadMoreError,
    revalidate,
    searchParams,
    total: current?.total,
  };
};
