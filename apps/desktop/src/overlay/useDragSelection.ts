import { useCallback, useRef, useState } from 'react';

export interface DragRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface DragPoint {
  x: number;
  y: number;
}

export interface DragSelectionTracker {
  readonly dragRect: DragRect | null;
  finish: () => void;
  readonly isDragging: boolean;
  move: (clientX: number, clientY: number) => DragRect | null;
  reset: () => void;
  start: (clientX: number, clientY: number) => void;
}

const toDragRect = (start: DragPoint, current: DragPoint): DragRect => ({
  height: Math.abs(current.y - start.y),
  width: Math.abs(current.x - start.x),
  x: Math.min(current.x, start.x),
  y: Math.min(current.y, start.y),
});

export function createDragSelectionTracker(): DragSelectionTracker {
  let dragRect: DragRect | null = null;
  let isDragging = false;
  let startPoint: DragPoint | null = null;

  return {
    get dragRect() {
      return dragRect;
    },
    get isDragging() {
      return isDragging;
    },
    finish() {
      isDragging = false;
      startPoint = null;
    },
    move(clientX, clientY) {
      if (!isDragging || !startPoint) return dragRect;

      dragRect = toDragRect(startPoint, { x: clientX, y: clientY });

      return dragRect;
    },
    reset() {
      dragRect = null;
      isDragging = false;
      startPoint = null;
    },
    start(clientX, clientY) {
      dragRect = null;
      isDragging = true;
      startPoint = { x: clientX, y: clientY };
    },
  };
}

export function useDragSelection() {
  const [dragRect, setDragRect] = useState<DragRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRectRef = useRef<DragRect | null>(null);
  const isDraggingRef = useRef(false);
  const trackerRef = useRef<DragSelectionTracker | null>(null);

  if (!trackerRef.current) {
    trackerRef.current = createDragSelectionTracker();
  }

  const syncRefs = useCallback(() => {
    dragRectRef.current = trackerRef.current?.dragRect ?? null;
    isDraggingRef.current = trackerRef.current?.isDragging ?? false;
  }, []);

  const onMouseDown = useCallback(
    (clientX: number, clientY: number) => {
      trackerRef.current?.start(clientX, clientY);
      syncRefs();
      setIsDragging(true);
      setDragRect(null);
    },
    [syncRefs],
  );

  const onMouseMove = useCallback(
    (clientX: number, clientY: number) => {
      const nextDragRect = trackerRef.current?.move(clientX, clientY) ?? null;
      syncRefs();

      if (nextDragRect) {
        setDragRect(nextDragRect);
      }
    },
    [syncRefs],
  );

  const onMouseUp = useCallback(() => {
    trackerRef.current?.finish();
    syncRefs();
    setIsDragging(false);
  }, [syncRefs]);

  const reset = useCallback(() => {
    trackerRef.current?.reset();
    syncRefs();
    setDragRect(null);
    setIsDragging(false);
  }, [syncRefs]);

  return {
    dragRect,
    dragRectRef,
    isDragging,
    isDraggingRef,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    reset,
  };
}
