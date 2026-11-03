import type React from 'react';
import { useRef, useState } from 'react';

interface UseDragAndDropOptions {
  accept?: string; // MIME type filter, e.g., 'image/*'
  onDrop: (files: File[]) => void;
}

export const useDragAndDrop = ({ onDrop, accept = 'image/*' }: UseDragAndDropOptions) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Check if dragging files
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current++;
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current = 0;
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);

    // Filter files based on accept type
    const filteredFiles = files.filter((file) => {
      if (accept === '*/*') return true;
      if (accept.endsWith('/*')) {
        const acceptType = accept.slice(0, -2);
        return file.type.startsWith(acceptType);
      }
      return file.type === accept;
    });

    if (filteredFiles.length > 0) {
      onDrop(filteredFiles);
    }
  };

  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: handleDrop,
  };

  return {
    dragHandlers,
    isDragOver,
  };
};
