'use client';

import { Center } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { type UIEvent, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { type FileListItem } from '@/types/files';

import { useMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryFileItem/MasonryItemWrapper';

const MasonryView = memo(() => {
  // Access all state from Resource Manager store
  const [
    libraryId,
    selectedFileIds,
    setSelectedFileIds,
    loadMoreKnowledgeItems,
    fileListHasMore,
    isMasonryReady,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
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

  // NEW: Read from resource store instead of fetching independently
  const resourceList = useFileStore((s) => s.resourceList);

  // Map ResourceItem[] to FileListItem[] for compatibility
  const rawData = resourceList?.map(
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
  );

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
