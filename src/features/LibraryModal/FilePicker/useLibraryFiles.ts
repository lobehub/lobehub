import { useCallback, useEffect, useMemo } from 'react';

import { useLibraryFilePickerList, useLibraryFilePickerStore } from '@/store/libraryFilePicker';
import type { ResourceItem } from '@/types/resource';

export type AttachableFile = ResourceItem & { sourceType: 'file'; url: string };

const isAttachableFile = (item: ResourceItem): item is AttachableFile =>
  item.sourceType === 'file' && Boolean(item.url);

const toFiles = (items: ResourceItem[] | undefined): AttachableFile[] => {
  const uniqueFiles = new Map<string, AttachableFile>();
  for (const item of items ?? []) {
    if (!isAttachableFile(item)) continue;
    uniqueFiles.set(item.fileId || item.id, item);
  }
  return [...uniqueFiles.values()];
};

/**
 * Files the library picker offers, from a replica: a reopened picker paints the
 * persisted head page while the server confirms it.
 */
export const useLibraryFiles = () => {
  const {
    error: fetchError,
    isConfirmed,
    revalidate,
    snapshotItems,
  } = useLibraryFilePickerStore((s) => s.useFetchFiles)();
  const loadMoreFiles = useLibraryFilePickerStore((s) => s.loadMoreFiles);
  const data = useLibraryFilePickerList();

  const listedFiles = useMemo(() => toFiles(data?.items), [data]);
  const snapshotFiles = useMemo(() => toFiles(snapshotItems), [snapshotItems]);
  const hasMore = Boolean(data?.hasMore);
  const isLoadingMore = Boolean(data?.isLoadingMore);
  // Restored pages past the head were dropped on confirmation; while the
  // re-listed pages have no file yet, keep the rows the user was looking at on
  // screen (not attachable) rather than flashing a skeleton.
  const showsSnapshot =
    isConfirmed &&
    listedFiles.length === 0 &&
    (hasMore || isLoadingMore) &&
    snapshotFiles.length > 0;
  const files = showsSnapshot ? snapshotFiles : listedFiles;
  // A failed refresh keeps the painted files; with none painted it is surfaced.
  const error = files.length > 0 ? undefined : (fetchError ?? data?.loadMoreError);
  const isAttachable = isConfirmed && !showsSnapshot;
  // The painted files are a snapshot the server has not re-listed (the head
  // refresh, or a later page after it, failed): they stay on screen but cannot
  // be attached, so the failure (and a retry of that request) must be offered.
  const pendingError = isConfirmed ? data?.loadMoreError : fetchError;
  const refreshError = files.length > 0 && !isAttachable ? pendingError : undefined;
  const retry = useCallback(
    () => (isConfirmed && data?.loadMoreError ? loadMoreFiles() : revalidate()),
    [data?.loadMoreError, isConfirmed, loadMoreFiles, revalidate],
  );
  // Nothing to show yet: no page at all, a restored page the server has not
  // confirmed, or later pages still to look through for an attachable file.
  const isLoading =
    files.length === 0 && !error && (!data || !isConfirmed || hasMore || isLoadingMore);

  // Pages of folders / documents only: keep paging until a file shows up.
  useEffect(() => {
    if (
      isConfirmed &&
      !isLoadingMore &&
      !data?.loadMoreError &&
      listedFiles.length === 0 &&
      hasMore
    ) {
      void loadMoreFiles();
    }
  }, [data?.loadMoreError, hasMore, isConfirmed, isLoadingMore, listedFiles.length, loadMoreFiles]);

  const loadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) void loadMoreFiles();
  }, [hasMore, isLoadingMore, loadMoreFiles]);

  return {
    error,
    files,
    hasMore,
    /**
     * A restored row's `url` may be a signed link that has since expired (or
     * the file may be gone), so a file is attachable only once the server has
     * re-listed it.
     */
    isAttachable,
    isLoading,
    isLoadingMore,
    loadMore,
    refreshError,
    retry,
  };
};
