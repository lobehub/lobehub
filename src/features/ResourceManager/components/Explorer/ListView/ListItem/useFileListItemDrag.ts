import type { DragEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getTransparentDragImage,
  useCurrentDrag,
  useDragActive,
  useSetCurrentDrag,
} from '@/features/ResourceManager/DndContextWrapper';
import {
  type DropPosition,
  getRelativeY,
  resolveDropPosition,
} from '@/features/ResourceManager/dragDropPosition';
import { useCurrentFolderId } from '@/features/ResourceManager/hooks/useCurrentFolderId';

interface UseFileListItemDragOptions {
  allowReorder?: boolean;
  fileType?: string | null;
  id: string;
  isFolder: boolean;
  itemParentId?: string | null;
  libraryId?: string;
  name?: string | null;
  sourceType?: string | null;
}

export const useFileListItemDrag = ({
  allowReorder = true,
  fileType,
  id,
  isFolder,
  itemParentId,
  libraryId,
  name,
  sourceType,
}: UseFileListItemDragOptions) => {
  const isDragActive = useDragActive();
  const currentDrag = useCurrentDrag();
  const setCurrentDrag = useSetCurrentDrag();
  // Prefer the item's own parent for cross-folder search hits; explicit null
  // means root, while rows without parent metadata use the open folder.
  const currentFolderId = useCurrentFolderId();
  const parentKey = itemParentId !== undefined ? (itemParentId ?? '') : (currentFolderId ?? '');

  const [isDragging, setIsDragging] = useState(false);
  const [dropPosition, setDropPosition] = useState<DropPosition>(null);

  const dragData = useMemo(
    () => ({
      fileType,
      isFolder,
      name,
      sourceType,
    }),
    [fileType, isFolder, name, sourceType],
  );

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      if (!libraryId) {
        e.preventDefault();
        return;
      }

      setIsDragging(true);
      setCurrentDrag({
        data: dragData,
        id,
        parentKey,
        type: isFolder ? 'folder' : 'file',
      });

      const img = getTransparentDragImage();
      if (img) {
        e.dataTransfer.setDragImage(img, 0, 0);
      }
      e.dataTransfer.effectAllowed = 'move';
    },
    [dragData, id, isFolder, libraryId, parentKey, setCurrentDrag],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDropPosition(null);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!isDragActive || !currentDrag) {
        setDropPosition(null);
        return;
      }

      const position = resolveDropPosition({
        allowReorder,
        drag: currentDrag,
        libraryId,
        relY: getRelativeY(e.clientY, e.currentTarget.getBoundingClientRect()),
        target: { id, isFolder, parentKey },
      });

      setDropPosition(position);
      if (!position) return;

      e.preventDefault();
      e.stopPropagation();
    },
    [allowReorder, currentDrag, id, isDragActive, isFolder, libraryId, parentKey],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && e.currentTarget.contains(nextTarget)) return;

    setDropPosition(null);
  }, []);

  const handleDrop = useCallback(() => {
    setDropPosition(null);
  }, []);

  // A drag can end outside this row (or be cancelled), which never fires the
  // row's own dragleave; drop the indicator when the shared drag goes away.
  useEffect(() => {
    if (!isDragActive) setDropPosition(null);
  }, [isDragActive]);

  return {
    dropPosition,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    isDragging,
    parentKey,
  };
};
