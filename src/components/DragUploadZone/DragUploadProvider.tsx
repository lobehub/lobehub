'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use, useCallback, useEffect, useRef, useState } from 'react';

interface DragUploadContextValue {
  /**
   * Whether files are being dragged anywhere on the page
   */
  isDraggingGlobally: boolean;
}

const DragUploadContext = createContext<DragUploadContextValue>({
  isDraggingGlobally: false,
});

/**
 * Hook to access global drag state
 */
export const useDragUploadContext = () => use(DragUploadContext);

interface DragUploadProviderProps {
  children: ReactNode;
}

/**
 * Provider that tracks global drag state across the entire page.
 * When files are dragged anywhere on the page, all DragUploadZone components
 * can highlight to show they are drop targets.
 */
export const DragUploadProvider = memo<DragUploadProviderProps>(({ children }) => {
  const [isDraggingGlobally, setIsDraggingGlobally] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;

    e.preventDefault();
    dragCounter.current += 1;

    if (dragCounter.current === 1) {
      setIsDraggingGlobally(true);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;

    e.preventDefault();
    dragCounter.current -= 1;

    if (dragCounter.current === 0) {
      setIsDraggingGlobally(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    // Prevent browser from opening the file if dropped outside a zone
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingGlobally(false);
  }, []);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop]);

  return <DragUploadContext value={{ isDraggingGlobally }}>{children}</DragUploadContext>;
});

DragUploadProvider.displayName = 'DragUploadProvider';
