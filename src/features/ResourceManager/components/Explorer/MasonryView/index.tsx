'use client';

import { Center, cssVar } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { type UIEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { sortFileList } from '@/features/ResourceManager/store/selectors';
import { useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

import { useExplorerSelectionActions } from '../hooks/useExplorerSelection';
import { isQueryNavigation } from '../isQueryNavigation';
import SourceFilter from '../ToolBar/SourceFilter';
import { useContainerMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryItem/MasonryItemWrapper';
import SelectionToolbar from './SelectionToolbar';
import MasonryViewSkeleton from './Skeleton';
import { useMasonryViewState } from './useMasonryViewState';

interface MasonryViewProps {
  isLoading?: boolean;
  isValidating?: boolean;
  queryParams: ResourceQueryParams;
}

const MasonryView = memo(function MasonryView({
  isLoading,
  isValidating,
  queryParams,
}: MasonryViewProps) {
  // Access all state from Resource Manager store
  const [libraryId, viewMode, sorter, sortType] = useResourceManagerStore((s) => [
    s.libraryId,
    s.viewMode,
    s.sorter,
    s.sortType,
  ]);

  const { t } = useTranslation(['components', 'file']);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const columnCount = useContainerMasonryColumnCount(container);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // NEW: Read from resource store instead of fetching independently
  const resourceList = useFileStore((s) => s.resourceList);
  const resourceTotal = useFileStore((s) => s.total);

  const { queryParams: currentQueryParams, hasMore, loadMoreResources } = useFileStore();

  const isNavigating = useMemo(
    () => isQueryNavigation(currentQueryParams, queryParams),
    [currentQueryParams, queryParams],
  );

  // Map ResourceItem[] to FileListItem[] for compatibility
  // Spread `item` first so file-backed fields (e.g. `fileId`) are preserved —
  // chunk actions need `fileId` to resolve `docs_*` ids to `file_*` ids (#16267).
  const rawData = useMemo(
    () =>
      resourceList?.map((item): FileListItem => ({
        ...item,
        chunkCount: item.chunkCount ?? null,
        chunkingError: item.chunkingError ?? null,
        chunkingStatus: (item.chunkingStatus as any) ?? null,
        embeddingError: item.embeddingError ?? null,
        embeddingStatus: (item.embeddingStatus as any) ?? null,
        finishEmbedding: item.finishEmbedding ?? false,
        url: item.url ?? '',
      })) ?? [],
    [resourceList],
  );

  // Sort data using current sort settings
  const data = useMemo(
    () => sortFileList(rawData, sorter, sortType) || [],
    [rawData, sorter, sortType],
  );

  const dataLength = data.length;
  const effectiveIsLoading = isLoading ?? false;
  const effectiveIsNavigating = isNavigating ?? false;
  const effectiveIsValidating = isValidating ?? false;
  const { isMasonryReady, showSkeleton } = useMasonryViewState({
    dataLength,
    isLoading: effectiveIsLoading,
    isNavigating: effectiveIsNavigating,
    isValidating: effectiveIsValidating,
    viewMode,
  });
  const { isItemSelectable, selectAllState, selectedFileIds, toggleItemSelection } =
    useExplorerSelectionActions(data);

  // Handle automatic load more when scrolling to bottom
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadMoreResources();
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, loadMoreResources]);

  const handleSelectionChange = useCallback(
    (id: string, checked: boolean) => {
      toggleItemSelection(id, checked);
    },
    [toggleItemSelection],
  );

  const masonryContext = useMemo(
    () => ({
      knowledgeBaseId: libraryId,
      isItemSelectable,
      onSelectedChange: handleSelectionChange,
      selectAllState,
      selectFileIds: selectedFileIds,
    }),
    [handleSelectionChange, isItemSelectable, libraryId, selectAllState, selectedFileIds],
  );

  // Handle scroll event to detect when near bottom
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;

      // Trigger load when within 300px of bottom
      if (scrollHeight - scrollTop - clientHeight < 300) {
        handleLoadMore();
      }
    },
    [handleLoadMore],
  );

  return showSkeleton ? (
    <MasonryViewSkeleton columnCount={columnCount} />
  ) : (
    <div
      style={{
        flex: 1,
        height: '100%',
        opacity: isMasonryReady ? 1 : 0,
        overflowY: 'auto',
        transition: 'opacity 0.2s ease-in-out',
      }}
      onScroll={handleScroll}
    >
      <div
        ref={setContainer}
        style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}
      >
        <SelectionToolbar
          data={data}
          extra={<SourceFilter />}
          hasMore={hasMore}
          itemCount={resourceTotal || dataLength}
        />
        <VirtuosoMasonry
          ItemContent={MasonryItemWrapper}
          columnCount={columnCount}
          context={masonryContext}
          data={data}
          style={{
            gap: '16px',
            overflow: 'hidden',
          }}
        />
        {isLoadingMore && (
          <Center
            style={{
              color: cssVar.colorTextDescription,
              fontSize: 14,
              marginBlockStart: 16,
              minHeight: 40,
            }}
          >
            {t('loading', { defaultValue: 'Loading...' })}
          </Center>
        )}
      </div>
    </div>
  );
});

export default MasonryView;
