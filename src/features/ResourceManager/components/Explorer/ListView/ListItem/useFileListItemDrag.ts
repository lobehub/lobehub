import type { DragEvent } from 'react';
import { useCallback, useMemo, useState } from 'react';

import {
  getTransparentDragImage,
  useDragActive,
  useSetCurrentDrag,
} from '@/routes/(main)/resource/features/DndContextWrapper';

interface UseFileListItemDragOptions {
  fileType?: string | null;
  id: string;
  isFolder: boolean;
  libraryId?: string;
  name?: string | null;
  sourceType?: string | null;
}

export const useFileListItemDrag = ({
  fileType,
  id,
  isFolder,
  libraryId,
  name,
  sourceType,
}: UseFileListItemDragOptions) => {
  const isDragActive = useDragActive();
  const setCurrentDrag = useSetCurrentDrag();

  const [isDragging, setIsDragging] = useState(false);
  const [isOver, setIsOver] = useState(false);

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
        type: isFolder ? 'folder' : 'file',
      });

      const img = getTransparentDragImage();
      if (img) {
        e.dataTransfer.setDragImage(img, 0, 0);
      }
      e.dataTransfer.effectAllowed = 'move';
    },
    [dragData, id, isFolder, libraryId, setCurrentDrag],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      if (!isFolder || !isDragActive) return;

      e.preventDefault();
      e.stopPropagation();
      setIsOver(true);
    },
    [isDragActive, isFolder],
  );

  const handleDragLeave = useCallback(() => {
    setIsOver(false);
  }, []);

  const handleDrop = useCallback(() => {
    setIsOver(false);
  }, []);

  return {
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    isDragging,
    isOver,
  };
};
