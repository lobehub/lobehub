'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use, useCallback, useEffect, useRef, useState } from 'react';

import { detectDragContentKind, type DragContentKind } from './useLocalDragUpload';

interface DragUploadContextValue {
  /**
   * Best-effort classification of the currently dragged content. Updated on
   * dragenter via DataTransferItem inspection. May be 'none' when nothing is
   * being dragged, or when item kinds cannot be read for security reasons.
   */
  dragContentKind: DragContentKind;
  /**
   * Whether files are being dragged anywhere on the page
   */
  isDraggingGlobally: boolean;
}

const DragUploadContext = createContext<DragUploadContextValue>({
  dragContentKind: 'none',
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
 * Watchdog grace period. While a drag is in progress the browser fires
 * `dragover` continuously; if no `dragover` has been seen for this long the
 * drag has ended without a matching event (Esc, drop outside the window, or a
 * `dragleave` lost to DOM churn), so the overlay must be force-closed.
 */
const DRAG_IDLE_TIMEOUT_MS = 1_000;

const WATCHDOG_INTERVAL_MS = 300;

/**
 * Provider that tracks global drag state across the entire page.
 * When files are dragged anywhere on the page, all DragUploadZone components
 * can highlight to show they are drop targets.
 */
export const DragUploadProvider = memo<DragUploadProviderProps>(({ children }) => {
  const [isDraggingGlobally, setIsDraggingGlobally] = useState(false);
  const [dragContentKind, setDragContentKind] = useState<DragContentKind>('none');
  const dragCounter = useRef(0);
  const lastDragOverAt = useRef(0);

  const endDrag = useCallback(() => {
    dragCounter.current = 0;
    lastDragOverAt.current = 0;
    setIsDraggingGlobally(false);
    setDragContentKind('none');
  }, []);

  const handleDragEnter = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;

    e.preventDefault();
    dragCounter.current += 1;

    if (dragCounter.current === 1) {
      lastDragOverAt.current = Date.now();
      setIsDraggingGlobally(true);
      setDragContentKind(detectDragContentKind(e.dataTransfer.items));
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    lastDragOverAt.current = Date.now();
  }, []);

  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;

      e.preventDefault();

      // relatedTarget is null when the drag left the window entirely. Browsers
      // can also lose the dragleave of a removed node mid-drag, so treat an
      // empty relatedTarget as a hard "left the page" signal instead of
      // decrementing the counter — the next dragenter re-opens the overlay if
      // the drag is still inside the page.
      if (!e.relatedTarget) {
        endDrag();
        return;
      }

      dragCounter.current = Math.max(0, dragCounter.current - 1);

      if (dragCounter.current === 0) {
        endDrag();
      }
    },
    [endDrag],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      // Prevent browser from opening the file if dropped outside a zone
      e.preventDefault();
      endDrag();
    },
    [endDrag],
  );

  // Self-healing watchdog: browsers do not guarantee dragenter/dragleave pairs
  // (a dragged-over node removed mid-drag, an Esc-cancelled drag, or a drop
  // outside the window can strand dragCounter above zero), and the overlay
  // would then never close — it even survives route changes because this
  // provider lives at the SPA root. dragover fires continuously during an
  // active drag, so once it goes silent the drag is over: force-reset.
  useEffect(() => {
    if (!isDraggingGlobally) return;

    const timer = setInterval(() => {
      if (Date.now() - lastDragOverAt.current > DRAG_IDLE_TIMEOUT_MS) {
        endDrag();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [endDrag, isDraggingGlobally]);

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

  return (
    <DragUploadContext value={{ dragContentKind, isDraggingGlobally }}>
      {children}
    </DragUploadContext>
  );
});

DragUploadProvider.displayName = 'DragUploadProvider';
