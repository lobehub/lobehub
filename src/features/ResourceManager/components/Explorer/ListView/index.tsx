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
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';

import ColumnResizeHandle from './ColumnResizeHandle';
import FileListItem from './ListItem';
import ListViewSkeleton from './Skeleton';

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
    min-width: 800px;
    height: 40px;
    min-height: 40px;
    color: ${cssVar.colorTextDescription};
  `,
  headerItem: css`
    height: 100%;
    padding-block: 6px;
    padding-inline: 0 24px;
  `,
  scrollContainer: css`
    overflow: auto hidden;
    flex: 1;
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

  // Access column widths from Global store
  const columnWidths = useGlobalStore(
    (s) => s.status.resourceManagerColumnWidths || INITIAL_STATUS.resourceManagerColumnWidths,
  );
  const updateColumnWidth = useGlobalStore((s) => s.updateResourceManagerColumnWidth);

  const { t } = useTranslation(['components', 'file']);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const isDragActive = useDragActive();
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { currentFolderSlug } = useFolderPath();
  const { data: folderBreadcrumb } = useResourceManagerFetchFolderBreadcrumb(currentFolderSlug);

  // Get current folder ID - either from breadcrumb or null for root
  const currentFolderId = folderBreadcrumb?.at(-1)?.id || null;

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
      // Always get the latest state from the store to avoid stale closure issues
      const currentSelected = useResourceManagerStore.getState().selectedFileIds;

      if (shiftKey && lastSelectedIndex !== null && data) {
        // Shift-click: select range from lastSelectedIndex to current index
        const start = Math.min(lastSelectedIndex, clickedIndex);
        const end = Math.max(lastSelectedIndex, clickedIndex);
        const rangeIds = data
          .slice(start, end + 1)
          .filter(Boolean)
          .map((item) => item.id);

        // Merge with existing selection
        const prevSet = new Set(currentSelected);
        rangeIds.forEach((rangeId) => prevSet.add(rangeId));
        setSelectedFileIds(Array.from(prevSet));
      } else {
        // Regular click: toggle single item
        if (checked) {
          setSelectedFileIds([...currentSelected, id]);
        } else {
          setSelectedFileIds(currentSelected.filter((item) => item !== id));
        }
      }
      setLastSelectedIndex(clickedIndex);
    },
    [lastSelectedIndex, data, setSelectedFileIds],
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

  // Clear auto-scroll timers
  const clearScrollTimers = useCallback(() => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  }, []);

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
    clearScrollTimers();
  }, [clearScrollTimers]);

  const handleDropZoneDrop = useCallback(() => {
    setIsDropZoneActive(false);
    clearScrollTimers();
  }, [clearScrollTimers]);

  // Handle auto-scroll during drag
  const handleDragMove = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!isDragActive || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const mouseY = e.clientY;
      const bottomThreshold = 200; // pixels from bottom edge
      const distanceFromBottom = rect.bottom - mouseY;

      // Check if mouse is near the bottom edge
      if (distanceFromBottom > 0 && distanceFromBottom <= bottomThreshold) {
        // If not already started, start the 2-second timer
        if (!scrollTimerRef.current && !autoScrollIntervalRef.current) {
          scrollTimerRef.current = setTimeout(() => {
            // After 2 seconds, start auto-scrolling
            autoScrollIntervalRef.current = setInterval(() => {
              virtuosoRef.current?.scrollBy({ top: 50 });
            }, 100); // Scroll every 100ms for smooth scrolling
            scrollTimerRef.current = null;
          }, 2000);
        }
      } else {
        // Mouse moved away from bottom edge, clear timers
        clearScrollTimers();
      }
    },
    [isDragActive, clearScrollTimers],
  );

  // Clean up timers when drag ends or component unmounts
  useEffect(() => {
    if (!isDragActive) {
      clearScrollTimers();
    }
  }, [isDragActive, clearScrollTimers]);

  useEffect(() => {
    return () => {
      clearScrollTimers();
    };
  }, [clearScrollTimers]);

  // Memoize footer component to show skeleton loaders when loading more
  const Footer = useCallback(() => {
    if (!isLoadingMore || !fileListHasMore) return null;
    return <ListViewSkeleton columnWidths={columnWidths} />;
  }, [isLoadingMore, fileListHasMore, columnWidths]);

  return (
    <Flexbox height={'100%'}>
      <div className={styles.scrollContainer}>
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
          <Flexbox
            className={styles.headerItem}
            justify={'center'}
            style={{
              flexShrink: 0,
              maxWidth: columnWidths.name,
              minWidth: columnWidths.name,
              paddingInline: 8,
              paddingInlineEnd: 16,
              position: 'relative',
              width: columnWidths.name,
            }}
          >
            {t('FileManager.title.title')}
            <ColumnResizeHandle
              column="name"
              currentWidth={columnWidths.name}
              maxWidth={1200}
              minWidth={200}
              onResize={(width) => updateColumnWidth('name', width)}
            />
          </Flexbox>
          <Flexbox
            className={styles.headerItem}
            justify={'center'}
            style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
            width={columnWidths.date}
          >
            {t('FileManager.title.createdAt')}
            <ColumnResizeHandle
              column="date"
              currentWidth={columnWidths.date}
              maxWidth={300}
              minWidth={120}
              onResize={(width) => updateColumnWidth('date', width)}
            />
          </Flexbox>
          <Flexbox
            className={styles.headerItem}
            justify={'center'}
            style={{ flexShrink: 0, paddingInlineEnd: 16, position: 'relative' }}
            width={columnWidths.size}
          >
            {t('FileManager.title.size')}
            <ColumnResizeHandle
              column="size"
              currentWidth={columnWidths.size}
              maxWidth={200}
              minWidth={80}
              onResize={(width) => updateColumnWidth('size', width)}
            />
          </Flexbox>
        </Flexbox>
        <div
          className={cx(styles.dropZone, isDropZoneActive && styles.dropZoneActive)}
          data-drop-target-id={currentFolderId || undefined}
          data-is-folder="true"
          onDragLeave={handleDropZoneDragLeave}
          onDragOver={(e) => {
            handleDropZoneDragOver(e);
            handleDragMove(e);
          }}
          onDrop={handleDropZoneDrop}
          ref={containerRef}
          style={{ overflow: 'hidden', position: 'relative' }}
        >
          <Virtuoso
            components={{ Footer }}
            data={data || []}
            defaultItemHeight={48}
            endReached={handleEndReached}
            increaseViewportBy={{ bottom: 800, top: 1200 }}
            initialItemCount={30}
            itemContent={(index, item) => {
              if (!item) return null;
              return (
                <FileListItem
                  columnWidths={columnWidths}
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
            style={{ height: 'calc(100vh - 100px)' }}
          />
        </div>
      </div>
    </Flexbox>
  );
});

export default ListView;
