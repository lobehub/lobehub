'use client';

import { Center, Checkbox, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import debug from 'debug';
import { type DragEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { useDragActive } from '@/app/[variants]/(main)/resource/features/DndContextWrapper';
import { useFolderPath } from '@/app/[variants]/(main)/resource/features/hooks/useFolderPath';
import {
  useResourceManagerFetchFolderBreadcrumb,
  useResourceManagerFetchKnowledgeItems,
  useResourceManagerStore,
} from '@/app/[variants]/(main)/resource/features/store';
import { sortFileList } from '@/app/[variants]/(main)/resource/features/store/selectors';

import FileListItem, { FILE_DATE_WIDTH, FILE_SIZE_WIDTH } from './ListItem';

const log = debug('resource-manager:list-view');

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
  loadingIndicator: css`
    padding: 16px;
    font-size: 14px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const ListView = memo(() => {
  // Access all state from Resource Manager store
  const [
    libraryId,
    category,
    searchQuery,
    selectFileIds,
    setSelectedFileIds,
    pendingRenameItemId,
    fileListHasMore,
    loadMoreKnowledgeItems,
    sorter,
    sortType,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.searchQuery,
    s.selectedFileIds,
    s.setSelectedFileIds,
    s.pendingRenameItemId,
    s.fileListHasMore,
    s.loadMoreKnowledgeItems,
    s.sorter,
    s.sortType,
  ]);

  const { t } = useTranslation(['components', 'file']);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const isDragActive = useDragActive();
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);

  const { currentFolderSlug } = useFolderPath();
  const { data: folderBreadcrumb } = useResourceManagerFetchFolderBreadcrumb(currentFolderSlug);

  // Get current folder ID - either from breadcrumb or null for root
  const currentFolderId = folderBreadcrumb?.at(-1)?.id || null;

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

  // Handle selection change with shift-click support for range selection
  const handleSelectionChange = useCallback(
    (id: string, checked: boolean, shiftKey: boolean, clickedIndex: number) => {
      if (shiftKey && lastSelectedIndex !== null && selectFileIds.length > 0 && data) {
        const start = Math.min(lastSelectedIndex, clickedIndex);
        const end = Math.max(lastSelectedIndex, clickedIndex);
        const rangeIds = data
          .slice(start, end + 1)
          .filter(Boolean)
          .map((item) => item.id);

        const prevSet = new Set(selectFileIds);
        rangeIds.forEach((rangeId) => prevSet.add(rangeId));
        setSelectedFileIds(Array.from(prevSet));
      } else {
        if (checked) {
          setSelectedFileIds([...selectFileIds, id]);
        } else {
          setSelectedFileIds(selectFileIds.filter((item) => item !== id));
        }
      }
      setLastSelectedIndex(clickedIndex);
    },
    [lastSelectedIndex, selectFileIds, data, setSelectedFileIds],
  );

  // Clean up invalid selections when data changes
  useEffect(() => {
    if (data && selectFileIds.length > 0) {
      const validFileIds = new Set(data.map((item) => item?.id).filter(Boolean));
      const filteredSelection = selectFileIds.filter((id) => validFileIds.has(id));
      if (filteredSelection.length !== selectFileIds.length) {
        setSelectedFileIds(filteredSelection);
      }
    }
  }, [data, selectFileIds, setSelectedFileIds]);

  // Reset last selected index when all selections are cleared
  useEffect(() => {
    if (selectFileIds.length === 0) {
      setLastSelectedIndex(null);
    }
  }, [selectFileIds.length]);

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
      setSelectedFileIds(data?.filter((item) => item).map((item) => item.id) || []);
    }
  };

  // Handle automatic load more when reaching the end
  const handleEndReached = useCallback(async () => {
    log('handleEndReached', fileListHasMore, isLoadingMore);

    if (!fileListHasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadMoreKnowledgeItems();
    } finally {
      setIsLoadingMore(false);
    }
  }, [fileListHasMore, loadMoreKnowledgeItems, isLoadingMore]);

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
        <Virtuoso
          data={data || []}
          defaultItemHeight={48}
          endReached={handleEndReached}
          increaseViewportBy={{ bottom: 800, top: 1200 }}
          initialItemCount={30}
          itemContent={(index, item) => {
            if (!item) return null;
            return (
              <FileListItem
                index={index}
                key={item.id}
                onSelectedChange={handleSelectionChange}
                pendingRenameItemId={pendingRenameItemId}
                selected={selectFileIds.includes(item.id)}
                {...item}
              />
            );
          }}
          overscan={48 * 5}
          ref={virtuosoRef}
          style={{ height: '100%' }}
        />
        {isLoadingMore && (
          <Center
            className={styles.loadingIndicator}
            style={{
              borderBlockStart: `1px solid ${cssVar.colorBorderSecondary}`,
            }}
          >
            {t('loading', { defaultValue: 'Loading...', ns: 'file' })}
          </Center>
        )}
      </div>
    </Flexbox>
  );
});

export default ListView;
