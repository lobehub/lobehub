import { useCallback, useEffect, useMemo } from 'react';

import { useLibraryFilePickerList, useLibraryFilePickerStore } from '@/store/libraryFilePicker';
import type { ResourceItem } from '@/types/resource';

export type AttachableFile = ResourceItem & { sourceType: 'file'; url: string };

const isAttachableFile = (item: ResourceItem): item is AttachableFile =>
  item.sourceType === 'file' && Boolean(item.url);

/**
 * Files the library picker offers, from a replica: a reopened picker paints the
 * persisted head page while the server confirms it.
 */
export const useLibraryFiles = () => {
  const {
    error: fetchError,
    isConfirmed,
    revalidate,
  } = useLibraryFilePickerStore((s) => s.useFetchFiles)();
  const loadMoreFiles = useLibraryFilePickerStore((s) => s.loadMoreFiles);
  const data = useLibraryFilePickerList();

  const files = useMemo(() => {
    const uniqueFiles = new Map<string, AttachableFile>();
    for (const item of data?.items ?? []) {
      if (!isAttachableFile(item)) continue;
      uniqueFiles.set(item.fileId || item.id, item);
    }
    return [...uniqueFiles.values()];
  }, [data]);
  const hasMore = Boolean(data?.hasMore);
  const isLoadingMore = Boolean(data?.isLoadingMore);
  // A failed refresh keeps the painted files; with none painted it is surfaced.
  const error = files.length > 0 ? undefined : (fetchError ?? data?.loadMoreError);
  // The painted files are a restored snapshot the server could not confirm:
  // they stay on screen but cannot be attached, so the failure (and a retry)
  // must still be offered.
  const refreshError = files.length > 0 && !isConfirmed ? fetchError : undefined;
  // Nothing to show yet: no page at all, a restored page the server has not
  // confirmed, or later pages still to look through for an attachable file.
  const isLoading =
    files.length === 0 && !error && (!data || !isConfirmed || hasMore || isLoadingMore);

  // Pages of folders / documents only: keep paging until a file shows up.
  useEffect(() => {
    if (isConfirmed && !isLoadingMore && !data?.loadMoreError && files.length === 0 && hasMore) {
      void loadMoreFiles();
    }
  }, [data?.loadMoreError, files.length, hasMore, isConfirmed, isLoadingMore, loadMoreFiles]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) void loadMoreFiles();
  }, [hasMore, isLoadingMore, loadMoreFiles]);

  return {
    error,
    files,
    hasMore,
    /**
     * A restored row's `url` may be a signed link that has since expired, so a
     * file is attachable only once the server has re-listed it.
     */
    isAttachable: isConfirmed,
    isLoading,
    isLoadingMore,
    loadMore,
    refreshError,
    retry: revalidate,
  };
};
