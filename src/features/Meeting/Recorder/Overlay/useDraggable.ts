import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useState } from 'react';

import { clampPosition, type Point } from './dragPosition';

interface DragState {
  offset: Point;
  pointerId: number;
}

const viewportSize = () => ({ height: window.innerHeight, width: window.innerWidth });

/**
 * Drag a fixed-position box by a handle. While dragging the position is local
 * state; it is committed once on release, so the store is not written on every
 * pointer move.
 */
export const useDraggable = (
  boxRef: RefObject<HTMLElement | null>,
  position: Point | undefined,
  onCommit: (position: Point) => void,
) => {
  const [dragging, setDragging] = useState<DragState>();
  const [livePosition, setLivePosition] = useState<Point>();

  // Keep a stored position reachable after the window shrinks.
  useEffect(() => {
    if (!position) return;
    const handleResize = () => {
      const box = boxRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = clampPosition(position, box, viewportSize());
      if (next.x !== position.x || next.y !== position.y) onCommit(next);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [boxRef, onCommit, position]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // Buttons inside the handle keep their own clicks.
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging({
      offset: { x: event.clientX - box.left, y: event.clientY - box.top },
      pointerId: event.pointerId,
    });
    setLivePosition({ x: box.left, y: box.top });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;

    setLivePosition(
      clampPosition(
        { x: event.clientX - dragging.offset.x, y: event.clientY - dragging.offset.y },
        box,
        viewportSize(),
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    if (livePosition) onCommit(livePosition);
    setDragging(undefined);
    setLivePosition(undefined);
  };

  return {
    dragging: !!dragging,
    handleProps: {
      onPointerCancel: endDrag,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
    },
    position: livePosition ?? position,
  };
};
