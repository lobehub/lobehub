import type { DragEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

import { useDragActive } from '@/routes/(main)/resource/features/DndContextWrapper';

export const useExplorerDropZone = (virtuosoRef: RefObject<VirtuosoHandle | null>) => {
  const isDragActive = useDragActive();
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleDragLeave = useCallback(() => {
    setIsDropZoneActive(false);
    clearScrollTimers();
  }, [clearScrollTimers]);

  const handleDrop = useCallback(() => {
    setIsDropZoneActive(false);
    clearScrollTimers();
  }, [clearScrollTimers]);

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!isDragActive || !containerRef.current) return;

      e.preventDefault();
      e.stopPropagation();
      setIsDropZoneActive(true);

      const rect = containerRef.current.getBoundingClientRect();
      const distanceFromBottom = rect.bottom - e.clientY;
      const bottomThreshold = 200;

      if (distanceFromBottom > 0 && distanceFromBottom <= bottomThreshold) {
        if (!scrollTimerRef.current && !autoScrollIntervalRef.current) {
          scrollTimerRef.current = setTimeout(() => {
            autoScrollIntervalRef.current = setInterval(() => {
              virtuosoRef.current?.scrollBy({ top: 50 });
            }, 100);
            scrollTimerRef.current = null;
          }, 2000);
        }

        return;
      }

      clearScrollTimers();
    },
    [clearScrollTimers, isDragActive, virtuosoRef],
  );

  useEffect(() => {
    if (!isDragActive) {
      clearScrollTimers();
    }
  }, [clearScrollTimers, isDragActive]);

  useEffect(
    () => () => {
      clearScrollTimers();
    },
    [clearScrollTimers],
  );

  return {
    containerRef,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    isDropZoneActive,
  };
};
