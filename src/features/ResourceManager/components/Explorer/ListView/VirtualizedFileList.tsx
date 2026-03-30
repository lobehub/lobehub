import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Virtuoso } from 'react-virtuoso';

import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { isExplorerItemSelected } from '@/routes/(main)/resource/features/store/selectors';
import type { FileListItem } from '@/types/files';

import { useExplorerSelectionActions } from '../hooks/useExplorerSelection';
import FileListItemComponent from './ListItem';
import { useExplorerInfiniteScroll } from './useExplorerInfiniteScroll';

interface VirtualizedFileListProps {
  columnWidths: {
    date: number;
    name: number;
    size: number;
  };
  data: FileListItem[];
  hasMore: boolean;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const VirtualizedFileList = ({
  columnWidths,
  data,
  hasMore,
  virtuosoRef,
}: VirtualizedFileListProps) => {
  const {
    clearSelectAllState,
    selectAllState,
    selectedFileIds,
    setSelectedFileIds,
    toggleItemSelection,
  } = useExplorerSelectionActions(data);
  const { Footer, handleEndReached } = useExplorerInfiniteScroll({
    columnWidths,
    dataLength: data.length,
    hasMore,
  });
  const dataRef = useRef<FileListItem[]>(data);
  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

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
      if (shiftKey && lastSelectedIndexRef.current !== null && dataRef.current.length > 0) {
        clearSelectAllState();

        const currentSelected = useResourceManagerStore.getState().selectedFileIds;
        const start = Math.min(lastSelectedIndexRef.current, clickedIndex);
        const end = Math.max(lastSelectedIndexRef.current, clickedIndex);
        const rangeIds = dataRef.current.slice(start, end + 1).map((item) => item.id);
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
    [clearSelectAllState, setSelectedFileIds, toggleItemSelection],
  );

  return (
    <Virtuoso
      components={{ Footer }}
      data={data}
      defaultItemHeight={48}
      endReached={handleEndReached}
      increaseViewportBy={{ bottom: 800, top: 1200 }}
      initialItemCount={30}
      overscan={48 * 5}
      ref={virtuosoRef}
      style={{ height: 'calc(100vh - 100px)' }}
      itemContent={useCallback(
        (index: number, item: FileListItem) => {
          if (!item) return null;

          return (
            <FileListItemComponent
              columnWidths={columnWidths}
              index={index}
              key={item.id}
              selected={isExplorerItemSelected({
                id: item.id,
                selectAllState,
                selectedIds: selectedFileIds,
              })}
              onSelectedChange={handleSelectionChange}
              {...item}
            />
          );
        },
        [columnWidths, handleSelectionChange, selectAllState, selectedFileIds],
      )}
    />
  );
};

export default VirtualizedFileList;
