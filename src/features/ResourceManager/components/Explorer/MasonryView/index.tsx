'use client';

import { Button, Center, Checkbox, Flexbox } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { createStaticStyles, cssVar } from 'antd-style';
import { type UIEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { sortFileList } from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

import {
  useExplorerSelectionActions,
  useExplorerSelectionSummary,
} from '../hooks/useExplorerSelection';
import { useMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryItem/MasonryItemWrapper';
import MasonryViewSkeleton from './Skeleton';
import { useMasonryViewState } from './useMasonryViewState';

const styles = createStaticStyles(({ css }) => ({
  selectAllHint: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 53px;

    padding-block: 8px;
    padding-inline: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillTertiary};
  `,
  toolbar: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 0;

    padding-block: 12px;
    padding-inline: 4px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
}));

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
  const columnCount = useMasonryColumnCount();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // NEW: Read from resource store instead of fetching independently
  const resourceList = useFileStore((s) => s.resourceList);
  const total = useFileStore((s) => s.total);

  const { queryParams: currentQueryParams, hasMore, loadMoreResources } = useFileStore();

  const isNavigating = useMemo(() => {
    if (!currentQueryParams || !queryParams) return false;

    return (
      currentQueryParams.libraryId !== queryParams.libraryId ||
      currentQueryParams.parentId !== queryParams.parentId ||
      currentQueryParams.category !== queryParams.category
    );
  }, [currentQueryParams, queryParams]);

  // Map ResourceItem[] to FileListItem[] for compatibility
  const rawData = useMemo(
    () =>
      resourceList?.map(
        (item): FileListItem => ({
          chunkCount: item.chunkCount ?? null,
          chunkingError: item.chunkingError ?? null,
          chunkingStatus: (item.chunkingStatus as any) ?? null,
          content: item.content,
          createdAt: item.createdAt,
          editorData: item.editorData,
          embeddingError: item.embeddingError ?? null,
          embeddingStatus: (item.embeddingStatus as any) ?? null,
          fileType: item.fileType,
          finishEmbedding: item.finishEmbedding ?? false,
          id: item.id,
          metadata: item.metadata,
          name: item.name,
          parentId: item.parentId,
          size: item.size,
          slug: item.slug,
          sourceType: item.sourceType,
          updatedAt: item.updatedAt,
          url: item.url ?? '',
        }),
      ) ?? [],
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
  const {
    handleSelectAll,
    handleSelectAllResources,
    selectAllState,
    selectedFileIds,
    toggleItemSelection,
  } = useExplorerSelectionActions(data);
  const { allSelected, indeterminate, selectedCount, showSelectAllHint } =
    useExplorerSelectionSummary({
      data,
      hasMore,
    });
  const isAllResultsSelected = selectAllState === 'all' && total === selectedCount;

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
      onSelectedChange: handleSelectionChange,
      selectAllState,
      selectFileIds: selectedFileIds,
    }),
    [handleSelectionChange, libraryId, selectAllState, selectedFileIds],
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
      <div style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}>
        <Flexbox horizontal align={'center'} className={styles.toolbar} gap={8}>
          <Checkbox
            checked={allSelected}
            indeterminate={indeterminate}
            onChange={handleSelectAll}
          />
          <span>
            {selectedCount > 0 || selectAllState === 'all'
              ? t(
                  selectAllState === 'all'
                    ? total
                      ? isAllResultsSelected
                        ? 'FileManager.total.allSelectedCount'
                        : 'FileManager.total.selectedCount'
                      : 'FileManager.total.allSelectedFallback'
                    : 'FileManager.total.selectedCount',
                  {
                    count: selectedCount,
                    ns: 'components',
                  },
                )
              : t('FileManager.total.fileCount', {
                  count: total || dataLength,
                  ns: 'components',
                })}
          </span>
        </Flexbox>
        {showSelectAllHint && (
          <Flexbox
            horizontal
            align={'center'}
            className={styles.selectAllHint}
            gap={6}
            paddingInline={4}
            wrap={'wrap'}
          >
            <span>
              {t(
                selectAllState === 'all'
                  ? total
                    ? isAllResultsSelected
                      ? 'FileManager.total.allSelectedCount'
                      : 'FileManager.total.selectedCount'
                    : 'FileManager.total.allSelectedFallback'
                  : 'FileManager.total.loadedSelectedCount',
                {
                  count: selectedCount,
                  ns: 'components',
                },
              )}
            </span>
            {selectAllState !== 'all' && (
              <Button size={'small'} type={'link'} onClick={handleSelectAllResources}>
                {total && total > dataLength
                  ? t('FileManager.total.selectAll', {
                      count: total,
                      ns: 'components',
                    })
                  : t('FileManager.total.selectAllFallback', {
                      ns: 'components',
                    })}
              </Button>
            )}
          </Flexbox>
        )}
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
