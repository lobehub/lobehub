import { useMemo } from 'react';

import { useCurrentFolderId } from '@/features/ResourceManager/hooks/useCurrentFolderId';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { sortFileList } from '@/features/ResourceManager/store/selectors';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import {
  DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
  INITIAL_STATUS,
} from '@/store/global/initialState';
import type { AsyncTaskStatus } from '@/types/asyncTask';
import type { FileListItem } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

import { isQueryNavigation } from '../isQueryNavigation';

interface UseExplorerListDataParams {
  isLoading?: boolean;
  isValidating?: boolean;
  queryParams: ResourceQueryParams;
}

export const useExplorerListData = ({
  isLoading,
  isValidating: _isValidating,
  queryParams,
}: UseExplorerListDataParams) => {
  const [sorter, sortType] = useResourceManagerStore((s) => [s.sorter, s.sortType]);
  const columnWidths = useGlobalStore((s) => ({
    ...DEFAULT_RESOURCE_MANAGER_COLUMN_WIDTHS,
    ...(s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths),
  }));
  const currentFolderId = useCurrentFolderId();
  const { currentQueryParams, hasMore, resourceList } = useFileStore((s) => ({
    currentQueryParams: s.queryParams,
    hasMore: s.hasMore,
    resourceList: s.resourceList,
  }));

  const isNavigating = useMemo(
    () => isQueryNavigation(currentQueryParams, queryParams),
    [currentQueryParams, queryParams],
  );

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

  const showSkeleton = ((isLoading ?? false) && data.length === 0) || !!isNavigating;

  return {
    columnWidths,
    currentFolderId,
    data,
    hasMore,
    showSkeleton,
  };
};
