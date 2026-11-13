import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ListRange, VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { isExplorerItemSelected } from '@/features/ResourceManager/store/selectors';
import type { FileListItem } from '@/types/files';

import { useExplorerSelectionActions } from '../hooks/useExplorerSelection';
import FileListItemComponent from './ListItem';
import {
  ExplorerListFooter,
  type ExplorerListFooterContext,
  useExplorerInfiniteScroll,
} from './useExplorerInfiniteScroll';

const LIST_COMPONENTS = { Footer: ExplorerListFooter };

const ROW_HEIGHT = 48;

/**
 * Rows rendered beyond the viewport. The previous 2000px budget kept ~40
 * off-screen interactive rows mounted, and every scroll step had to mount a
 * matching batch, blocking the main thread long enough for a fling to outrun
 * the rendered rows (a white list). Measured under 4x CPU throttling, a small
 * margin keeps each step short; a deeper one (20 rows) made the blank frames
 * worse, not better.
 */
const INCREASE_VIEWPORT_BY = { bottom: ROW_HEIGHT * 8, top: ROW_HEIGHT * 4 };

/**
 * Rows before the end at which the next page starts loading. Rendering margin
 * and prefetch distance are separate on purpose: `endReached` alone only fires
 * once the last row is rendered, which the small margin above would delay
 * until the user is already at the bottom.
 */
const PREFETCH_ROWS = 20;

const computeItemKey = (index: number, item: FileListItem | undefined) => item?.id ?? index;

interface VirtualizedFileListProps {
  allowReorder?: boolean;
  columnWidths: {
    date: number;
    name: number;
    size: number;
    uploader: number;
  };
  data: FileListItem[];
  hasMore: boolean;
  /**
   * Viewport height. Defaults to the folder list's viewport-derived height; a
   * consumer inside a sized flex container passes `'100%'` to fill it.
   */
  height?: string;
  /** Next-page loader; defaults to the folder list's. */
  loadMore?: () => Promise<void>;
  /** Failure of a page past the head, rendered as a retry row in the footer. */
  loadMoreError?: unknown;
  showUploader?: boolean;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const VirtualizedFileList = ({
  allowReorder = true,
  columnWidths,
  data,
  hasMore,
  height = 'calc(100vh - 100px)',
  loadMore,
  loadMoreError,
  showUploader = true,
  virtuosoRef,
}: VirtualizedFileListProps) => {
  const {
    clearSelectAllState,
    isItemSelectable,
    selectAllState,
    selectedFileIds,
    setSelectedFileIds,
    toggleItemSelection,
  } = useExplorerSelectionActions(data);
  const { footerContext, handleEndReached, prefetchMore } = useExplorerInfiniteScroll({
    columnWidths,
    dataLength: data.length,
    hasMore,
    loadMore,
    loadMoreError,
    showUploader,
  });
  const dataLength = data.length;
  const handleRangeChanged = useCallback(
    ({ endIndex }: ListRange) => {
      if (hasMore && endIndex >= dataLength - PREFETCH_ROWS) void prefetchMore();
    },
    [dataLength, hasMore, prefetchMore],
  );
  const dataRef = useRef<FileListItem[]>(data);
  const lastSelectedIndexRef = useRef<number | null>(null);
  // The selection helpers are rebuilt whenever `data` changes (every page
  // load). Reading them through a ref keeps `handleSelectionChange` — a prop of
  // every row — stable, so loading a page no longer re-renders each mounted row.
  const selectionActionsRef = useRef({
    clearSelectAllState,
    isItemSelectable,
    setSelectedFileIds,
    toggleItemSelection,
  });

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useLayoutEffect(() => {
    selectionActionsRef.current = {
      clearSelectAllState,
      isItemSelectable,
      setSelectedFileIds,
      toggleItemSelection,
    };
  });

  useEffect(() => {
    return useResourceManagerStore.subscribe(
      (s) => s.selectedFileIds.length,
      (selectedCount) => {
        if (selectedCount === 0) {
          lastSelectedIndexRef.current = null;
        }
      },
    );
  }, []);

  const handleSelectionChange = useCallback(
    (id: string, checked: boolean, shiftKey: boolean, clickedIndex: number) => {
      const { clearSelectAllState, isItemSelectable, setSelectedFileIds, toggleItemSelection } =
        selectionActionsRef.current;

      if (shiftKey && lastSelectedIndexRef.current !== null && dataRef.current.length > 0) {
        clearSelectAllState();

        const currentSelected = useResourceManagerStore.getState().selectedFileIds;
        const start = Math.min(lastSelectedIndexRef.current, clickedIndex);
        const end = Math.max(lastSelectedIndexRef.current, clickedIndex);
        const rangeIds = dataRef.current
          .slice(start, end + 1)
          .filter(isItemSelectable)
          .map((item) => item.id);
        const nextSelected = new Set(currentSelected);

        for (const rangeId of rangeIds) {
          nextSelected.add(rangeId);
        }

        setSelectedFileIds(Array.from(nextSelected));
      } else {
        toggleItemSelection(id, checked);
      }

      lastSelectedIndexRef.current = clickedIndex;
    },
    [],
  );

  return (
    <Virtuoso<FileListItem, ExplorerListFooterContext>
      components={LIST_COMPONENTS}
      computeItemKey={computeItemKey}
      context={footerContext}
      data={data}
      defaultItemHeight={ROW_HEIGHT}
      endReached={handleEndReached}
      fixedItemHeight={ROW_HEIGHT}
      increaseViewportBy={INCREASE_VIEWPORT_BY}
      initialItemCount={Math.min(30, data.length)}
      rangeChanged={handleRangeChanged}
      ref={virtuosoRef}
      style={{ height }}
      itemContent={useCallback(
        (index: number, item: FileListItem) => {
          if (!item) return null;

          const selectable = isItemSelectable(item);

          return (
            <FileListItemComponent
              allowReorder={allowReorder}
              columnWidths={columnWidths}
              index={index}
              selectable={selectable}
              showUploader={showUploader}
              selected={
                selectable &&
                isExplorerItemSelected({
                  id: item.id,
                  selectAllState,
                  selectedIds: selectedFileIds,
                })
              }
              onSelectedChange={handleSelectionChange}
              {...item}
            />
          );
        },
        [
          allowReorder,
          columnWidths,
          handleSelectionChange,
          isItemSelectable,
          selectAllState,
          selectedFileIds,
          showUploader,
        ],
      )}
    />
  );
};

export default VirtualizedFileList;
