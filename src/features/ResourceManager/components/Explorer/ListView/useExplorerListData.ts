import { useMemo } from 'react';

import { useCurrentFolderId } from '@/routes/(main)/resource/features/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { sortFileList } from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';
import type { AsyncTaskStatus } from '@/types/asyncTask';
import type { FileListItem } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

interface UseExplorerListDataParams {
  isLoading?: boolean;
  isValidating?: boolean;
  queryParams: ResourceQueryParams;
}

export const useExplorerListData = ({
  isLoading,
  isValidating,
  queryParams,
}: UseExplorerListDataParams) => {
  const [sorter, sortType] = useResourceManagerStore((s) => [s.sorter, s.sortType]);
  const columnWidths = useGlobalStore(
    (s) => s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths,
  );
  const currentFolderId = useCurrentFolderId();
  const { currentQueryParams, hasMore, resourceList } = useFileStore((s) => ({
    currentQueryParams: s.queryParams,
    hasMore: s.hasMore,
    resourceList: s.resourceList,
  }));

  const isNavigating = useMemo(() => {
    if (!currentQueryParams) return false;

    return (
      currentQueryParams.libraryId !== queryParams.libraryId ||
      currentQueryParams.parentId !== queryParams.parentId ||
      currentQueryParams.category !== queryParams.category
    );
  }, [currentQueryParams, queryParams]);

  const rawData = useMemo(
    () =>
      resourceList?.map<FileListItem>((item) => ({
        ...item,
        chunkCount: item.chunkCount ?? null,
        chunkingError: item.chunkingError ?? null,
        chunkingStatus: (item.chunkingStatus ?? null) as AsyncTaskStatus | null,
        embeddingError: item.embeddingError ?? null,
        embeddingStatus: (item.embeddingStatus ?? null) as AsyncTaskStatus | null,
        finishEmbedding: item.finishEmbedding ?? false,
        url: item.url ?? '',
      })) ?? [],
    [resourceList],
  );

  const data = useMemo(
    () => sortFileList(rawData, sorter, sortType) || [],
    [rawData, sorter, sortType],
  );

  const showSkeleton =
    ((isLoading ?? false) && data.length === 0) || ((isNavigating ?? false) && !!isValidating);

  return {
    columnWidths,
    currentFolderId,
    data,
    hasMore,
    showSkeleton,
  };
};
