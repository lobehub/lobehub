'use client';

import { Center } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { type FileListItem } from '@/types/files';

import { useMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryFileItem/MasonryItemWrapper';

interface MasonryViewProps {
  data: FileListItem[] | undefined;
  hasMore: boolean;
  isMasonryReady: boolean;
  loadMore: () => Promise<void>;
  onOpenFile?: (id: string) => void;
  selectFileIds: string[];
  setSelectedFileIds: (ids: string[]) => void;
}

const MasonryView = memo<MasonryViewProps>(
  ({ data, hasMore, isMasonryReady, loadMore, onOpenFile, selectFileIds, setSelectedFileIds }) => {
    const { t } = useTranslation('file');
    const columnCount = useMasonryColumnCount();
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const libraryId = useResourceManagerStore((s) => s.libraryId);

    const masonryContext = useMemo(
      () => ({
        knowledgeBaseId: libraryId,
        openFile: onOpenFile,
        selectFileIds,
        setSelectedFileIds,
      }),
      [onOpenFile, libraryId, selectFileIds, setSelectedFileIds],
    );

    // Handle automatic load more when scrolling to bottom
    const handleLoadMore = useCallback(async () => {
      if (!hasMore || isLoadingMore) return;

      setIsLoadingMore(true);
      try {
        await loadMore();
      } finally {
        setIsLoadingMore(false);
      }
    }, [hasMore, loadMore, isLoadingMore]);

    // Handle scroll event to detect when near bottom
    const handleScroll = useCallback(
      (e: React.UIEvent<HTMLDivElement>) => {
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
  },
);

export default MasonryView;
