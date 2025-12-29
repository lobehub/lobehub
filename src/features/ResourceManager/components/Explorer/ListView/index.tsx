'use client';

import { Button, Center, Checkbox, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type DragEvent, memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VList, type VListHandle } from 'virtua';

import { useDragActive } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import { useFileStore } from '@/store/file';
import { type FileListItem as FileListItemType } from '@/types/files';

import FileListItem, { FILE_DATE_WIDTH, FILE_SIZE_WIDTH } from './ListItem';

const styles = createStaticStyles(({ css }) => ({
  dropZone: css`
    position: relative;
    height: 100%;
  `,
  dropZoneActive: css`
    background: ${cssVar.colorPrimaryBg};
    outline: 2px dashed ${cssVar.colorPrimary};
    outline-offset: -4px;
  `,
  header: css`
    height: 40px;
    min-height: 40px;
    color: ${cssVar.colorTextDescription};
  `,
  headerItem: css`
    padding-block: 0;
    padding-inline: 0 24px;
  `,
  loadMoreContainer: css`
    padding: 16px;
  `,
}));

interface ListViewProps {
  data: FileListItemType[] | undefined;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  onSelectionChange: (
    id: string,
    checked: boolean,
    shiftKey: boolean,
    clickedIndex: number,
  ) => void;
  pendingRenameItemId?: string | null;
  selectFileIds: string[];
  setSelectedFileIds: (ids: string[]) => void;
}

const ListView = memo<ListViewProps>(
  ({
    data,
    hasMore,
    loadMore,
    onSelectionChange,
    pendingRenameItemId,
    selectFileIds,
    setSelectedFileIds,
  }) => {
    const { t } = useTranslation(['components', 'file']);
    const virtuaRef = useRef<VListHandle>(null);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const isDragActive = useDragActive();
    const [isDropZoneActive, setIsDropZoneActive] = useState(false);

    const { currentFolderSlug } = useFolderPath();
    const useFetchFolderBreadcrumb = useFileStore((s) => s.useFetchFolderBreadcrumb);
    const { data: folderBreadcrumb } = useFetchFolderBreadcrumb(currentFolderSlug);

    // Get current folder ID - either from breadcrumb or null for root
    const currentFolderId = folderBreadcrumb?.at(-1)?.id || null;

    // Calculate select all checkbox state
    const { allSelected, indeterminate } = useMemo(() => {
      const fileCount = data?.length || 0;
      const selectedCount = selectFileIds.length;
      return {
        allSelected: fileCount > 0 && selectedCount === fileCount,
        indeterminate: selectedCount > 0 && selectedCount < fileCount,
      };
    }, [data, selectFileIds]);

    // Handle select all checkbox change
    const handleSelectAll = () => {
      if (allSelected) {
        setSelectedFileIds([]);
      } else {
        setSelectedFileIds(data?.map((item) => item.id) || []);
      }
    };

    // Handle load more button click
    const handleLoadMore = useCallback(async () => {
      if (!hasMore || isLoadingMore) return;

      setIsLoadingMore(true);
      try {
        await loadMore();
      } finally {
        setIsLoadingMore(false);
      }
    }, [hasMore, loadMore, isLoadingMore]);

    // Drop zone handlers for dragging to blank space
    const handleDropZoneDragOver = useCallback(
      (e: DragEvent) => {
        if (!isDragActive) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDropZoneActive(true);
      },
      [isDragActive],
    );

    const handleDropZoneDragLeave = useCallback(() => {
      setIsDropZoneActive(false);
    }, []);

    const handleDropZoneDrop = useCallback(() => {
      setIsDropZoneActive(false);
    }, []);

    // Add virtual "load more" item to data if there's more to load
    const displayData = useMemo(() => {
      if (!data) return data;
      if (!hasMore) return data;
      // Add a fake item at the end to represent the Load More button
      return [...data, { id: '__load_more__', isLoadMorePlaceholder: true } as any];
    }, [data, hasMore]);

    return (
      <Flexbox height={'100%'}>
        <Flexbox
          align={'center'}
          className={styles.header}
          horizontal
          paddingInline={8}
          style={{
            borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
            fontSize: 12,
          }}
        >
          <Center height={40} style={{ paddingInline: 4 }}>
            <Checkbox
              checked={allSelected}
              indeterminate={indeterminate}
              onChange={handleSelectAll}
            />
          </Center>
          <Flexbox className={styles.headerItem} flex={1} style={{ paddingInline: 8 }}>
            {t('FileManager.title.title')}
          </Flexbox>
          <Flexbox className={styles.headerItem} width={FILE_DATE_WIDTH}>
            {t('FileManager.title.createdAt')}
          </Flexbox>
          <Flexbox className={styles.headerItem} width={FILE_SIZE_WIDTH}>
            {t('FileManager.title.size')}
          </Flexbox>
        </Flexbox>
        <div
          className={cx(styles.dropZone, isDropZoneActive && styles.dropZoneActive)}
          data-drop-target-id={currentFolderId || undefined}
          data-is-folder="true"
          onDragLeave={handleDropZoneDragLeave}
          onDragOver={handleDropZoneDragOver}
          onDrop={handleDropZoneDrop}
          style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        >
          <VList
            bufferSize={typeof window !== 'undefined' ? window.innerHeight : 0}
            data={displayData}
            itemSize={48}
            ref={virtuaRef}
            style={{ height: '100%' }}
          >
            {(item, index) => {
              // Render Load More button for the placeholder item
              if (item.isLoadMorePlaceholder) {
                return (
                  <Center
                    className={styles.loadMoreContainer}
                    key="load-more"
                    style={{
                      borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}`,
                    }}
                  >
                    <Button loading={isLoadingMore} onClick={handleLoadMore} type="default">
                      {t('loadMore', { defaultValue: 'Load More', ns: 'file' })}
                    </Button>
                  </Center>
                );
              }

              // Render normal file item
              return (
                <FileListItem
                  index={index}
                  key={item.id}
                  onSelectedChange={onSelectionChange}
                  pendingRenameItemId={pendingRenameItemId}
                  selected={selectFileIds.includes(item.id)}
                  {...item}
                />
              );
            }}
          </VList>
        </div>
      </Flexbox>
    );
  },
);

export default ListView;
