'use client';

import { Center } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { type UIEvent, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import {
  useResourceManagerFetchKnowledgeItems,
  useResourceManagerStore,
} from '@/app/[variants]/(main)/resource/features/store';
import { sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';

import { useMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryFileItem/MasonryItemWrapper';

const MasonryView = memo(() => {
  // Access all state from Resource Manager store
  const [
    libraryId,
    category,
    searchQuery,
    selectedFileIds,
    setSelectedFileIds,
    loadMoreKnowledgeItems,
    fileListHasMore,
    isMasonryReady,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.searchQuery,
    s.selectedFileIds,
    s.setSelectedFileIds,
    s.loadMoreKnowledgeItems,
    s.fileListHasMore,
    s.isMasonryReady,
    s.sorter,
    s.sortType,
  ]);

  const { t } = useTranslation('file');
  const columnCount = useMasonryColumnCount();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const { currentFolderSlug } = useFolderPath();

  // Fetch data with SWR
  const { data: rawData } = useResourceManagerFetchKnowledgeItems({
    category,
    knowledgeBaseId: libraryId,
    parentId: currentFolderSlug || null,
    q: searchQuery ?? undefined,
    showFilesInKnowledgeBase: false,
  });

  // Sort data using current sort settings
  const data = sortFileList(rawData, sorter, sortType);

  const masonryContext = useMemo(
    () => ({
      knowledgeBaseId: libraryId,
      selectFileIds: selectedFileIds,
      setSelectedFileIds,
    }),
    [libraryId, selectedFileIds, setSelectedFileIds],
  );

  // Handle automatic load more when scrolling to bottom
  const handleLoadMore = useCallback(async () => {
    if (!fileListHasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadMoreKnowledgeItems();
    } finally {
      setIsLoadingMore(false);
    }
  }, [fileListHasMore, loadMoreKnowledgeItems, isLoadingMore]);

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

  return (
    <div
      onScroll={handleScroll}
      style={{
        flex: 1,
        height: '100%',
        opacity: isMasonryReady ? 1 : 0,
        overflowY: 'auto',
        transition: 'opacity 0.2s ease-in-out',
      }}
    >
      <div style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}>
        <VirtuosoMasonry
          ItemContent={MasonryItemWrapper}
          columnCount={columnCount}
          context={masonryContext}
          data={data || []}
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
