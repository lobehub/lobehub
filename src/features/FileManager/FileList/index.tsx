'use client';

import { Text } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { createStyles } from 'antd-style';
import { useQueryState } from 'nuqs';
import { rgba } from 'polished';
import React, { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';
import { Virtuoso } from 'react-virtuoso';

import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';
import { SortType } from '@/types/files';

import EmptyStatus from './EmptyStatus';
import FileListItem, { FILE_DATE_WIDTH, FILE_SIZE_WIDTH } from './FileListItem';
import FileSkeleton from './FileSkeleton';
import MasonryItemWrapper from './MasonryFileItem/MasonryItemWrapper';
import MasonrySkeleton from './MasonrySkeleton';
import ToolBar from './ToolBar';
import { ViewMode } from './ToolBar/ViewSwitcher';
import { useCheckTaskStatus } from './useCheckTaskStatus';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  header: css`
    height: 40px;
    min-height: 40px;
    border-block-end: 1px solid ${isDarkMode ? token.colorSplit : rgba(token.colorSplit, 0.06)};
    color: ${token.colorTextDescription};
  `,
  headerItem: css`
    padding-block: 0;
    padding-inline: 0 24px;
  `,
  total: css`
    padding-block-end: 12px;
    border-block-end: 1px solid ${isDarkMode ? token.colorSplit : rgba(token.colorSplit, 0.06)};
  `,
}));

interface FileListProps {
  category?: string;
  knowledgeBaseId?: string;
  onOpenFile: (id: string) => void;
}

const FileList = memo<FileListProps>(({ knowledgeBaseId, category, onOpenFile }) => {
  const { t } = useTranslation('components');
  const { styles } = useStyles();

  const [selectFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [viewConfig, setViewConfig] = useState({ showFilesInKnowledgeBase: false });
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const viewMode = useGlobalStore((s) => s.status.fileManagerViewMode || 'list') as ViewMode;
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const setViewMode = (mode: ViewMode) => {
    setIsTransitioning(true);
    updateSystemStatus({ fileManagerViewMode: mode });
  };

  const [columnCount, setColumnCount] = useState(4);

  // Update column count based on window size
  const updateColumnCount = () => {
    const width = window.innerWidth;
    if (width < 768) {
      setColumnCount(2);
    } else if (width < 1024) {
      setColumnCount(3);
    } else if (width < 1440) {
      setColumnCount(4);
    } else {
      setColumnCount(5);
    }
  };

  // Set initial column count and listen for resize
  React.useEffect(() => {
    if (viewMode === 'masonry') {
      updateColumnCount();
      window.addEventListener('resize', updateColumnCount);
      return () => window.removeEventListener('resize', updateColumnCount);
    }
  }, [viewMode]);

  const [query] = useQueryState('q', {
    clearOnDefault: true,
  });

  const [sorter] = useQueryState('sorter', {
    clearOnDefault: true,
    defaultValue: 'createdAt',
  });
  const [sortType] = useQueryState('sortType', {
    clearOnDefault: true,
    defaultValue: SortType.Desc,
  });

  const useFetchFileManage = useFileStore((s) => s.useFetchFileManage);

  const { data, isLoading } = useFetchFileManage({
    category,
    knowledgeBaseId,
    q: query,
    sortType,
    sorter,
    ...viewConfig,
  });

  // Handle view transition with a brief delay to show skeleton
  React.useEffect(() => {
    if (isTransitioning && data) {
      // Use requestAnimationFrame to ensure smooth transition
      requestAnimationFrame(() => {
        const timer = setTimeout(() => {
          setIsTransitioning(false);
        }, 100);
        return () => clearTimeout(timer);
      });
    }
  }, [isTransitioning, viewMode, data]);

  useCheckTaskStatus(data);

  // Clean up selected files that no longer exist in the data
  React.useEffect(() => {
    if (data && selectFileIds.length > 0) {
      const validFileIds = new Set(data.map((item) => item?.id).filter(Boolean));
      const filteredSelection = selectFileIds.filter((id) => validFileIds.has(id));
      if (filteredSelection.length !== selectFileIds.length) {
        setSelectedFileIds(filteredSelection);
      }
    }
  }, [data]);

  // Reset lastSelectedIndex when selection is cleared
  React.useEffect(() => {
    if (selectFileIds.length === 0) {
      setLastSelectedIndex(null);
    }
  }, [selectFileIds.length]);

  // Memoize context object to avoid recreating on every render
  const masonryContext = useMemo(
    () => ({
      knowledgeBaseId,
      openFile: onOpenFile,
      selectFileIds,
      setSelectedFileIds,
    }),
    [onOpenFile, knowledgeBaseId, selectFileIds],
  );

  return !isLoading && data?.length === 0 ? (
    <EmptyStatus knowledgeBaseId={knowledgeBaseId} showKnowledgeBase={!knowledgeBaseId} />
  ) : (
    <Flexbox height={'100%'}>
      <Flexbox style={{ fontSize: 12, marginInline: 24 }}>
        <ToolBar
          config={viewConfig}
          key={selectFileIds.join('-')}
          knowledgeBaseId={knowledgeBaseId}
          onConfigChange={setViewConfig}
          onViewChange={setViewMode}
          selectCount={selectFileIds.length}
          selectFileIds={selectFileIds}
          setSelectedFileIds={setSelectedFileIds}
          showConfig={!knowledgeBaseId}
          total={data?.length}
          totalFileIds={data?.map((item) => item.id) || []}
          viewMode={viewMode}
        />
        {viewMode === 'list' && (
          <Flexbox align={'center'} className={styles.header} horizontal paddingInline={8}>
            <Flexbox className={styles.headerItem} flex={1} style={{ paddingInline: 32 }}>
              {t('FileManager.title.title')}
            </Flexbox>
            <Flexbox className={styles.headerItem} width={FILE_DATE_WIDTH}>
              {t('FileManager.title.createdAt')}
            </Flexbox>
            <Flexbox className={styles.headerItem} width={FILE_SIZE_WIDTH}>
              {t('FileManager.title.size')}
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
      {isLoading || isTransitioning ? (
        viewMode === 'masonry' ? (
          <MasonrySkeleton columnCount={columnCount} />
        ) : (
          <FileSkeleton />
        )
      ) : viewMode === 'list' ? (
        <Virtuoso
          components={{
            Footer: () => (
              <Center style={{ height: 64 }}>
                <Text style={{ fontSize: 12 }} type={'secondary'}>
                  {t('FileManager.bottom')}
                </Text>
              </Center>
            ),
          }}
          data={data}
          itemContent={(index, item) => (
            <FileListItem
              index={index}
              key={item.id}
              knowledgeBaseId={knowledgeBaseId}
              onSelectedChange={(id, checked, shiftKey, clickedIndex) => {
                if (shiftKey && lastSelectedIndex !== null && selectFileIds.length > 0 && data) {
                  // Range selection with shift key
                  const start = Math.min(lastSelectedIndex, clickedIndex);
                  const end = Math.max(lastSelectedIndex, clickedIndex);
                  const rangeIds = data.slice(start, end + 1).map((item) => item.id);

                  setSelectedFileIds((prev) => {
                    // Create a Set for efficient lookup
                    const prevSet = new Set(prev);
                    // Add all items in range
                    rangeIds.forEach((rangeId) => prevSet.add(rangeId));
                    return Array.from(prevSet);
                  });
                } else {
                  // Normal selection
                  setSelectedFileIds((prev) => {
                    if (checked) {
                      return [...prev, id];
                    }
                    return prev.filter((item) => item !== id);
                  });
                }
                setLastSelectedIndex(clickedIndex);
              }}
              selected={selectFileIds.includes(item.id)}
              {...item}
            />
          )}
          style={{ flex: 1 }}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <div style={{ paddingBlockEnd: 64, paddingBlockStart: 12, paddingInline: 24 }}>
              <VirtuosoMasonry
                ItemContent={MasonryItemWrapper}
                columnCount={columnCount}
                context={masonryContext}
                data={data || []}
                style={{
                  gap: '16px',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Flexbox>
  );
});

export default FileList;
