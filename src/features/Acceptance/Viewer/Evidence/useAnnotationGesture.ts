import type { AcceptanceReviewAnnotation } from '@lobechat/types';
import type { PointerEvent } from 'react';
import { useRef, useState } from 'react';

type Rect = AcceptanceReviewAnnotation['rect'];
/** An in-flight pointer gesture: drawing a new region, or moving/resizing one. */
type Gesture =
  | { kind: 'draw'; start: { x: number; y: number } }
  | { index: number; kind: 'move'; origin: Rect; start: { x: number; y: number } }
  | { index: number; kind: 'resize'; origin: Rect };

// Keep the minimum in displayed CSS pixels, independent of aspect ratio and zoom.
const MIN_REGION_PX = 3;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

export const useAnnotationGesture = ({
  drawing,
  onDraw,
  onUpdate,
}: {
  drawing: boolean;
  onDraw: (rect: Rect) => void;
  onUpdate: (index: number, rect: Rect) => void;
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // Normalize against the image's own box — the frame may not equal it.
  const normalize = (event: PointerEvent) => {
    const box = imageRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: clamp01((event.clientX - box.left) / box.width),
      y: clamp01((event.clientY - box.top) / box.height),
    };
  };

  const toRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
    height: Math.abs(a.y - b.y),
    width: Math.abs(a.x - b.x),
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
  });

  const endGesture = (event: PointerEvent) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setDraft(null);
    if (gesture?.kind !== 'draw') return;
    const point = normalize(event);
    if (!point) return;
    const rect = toRect(gesture.start, point);
    // Ignore accidental clicks — a region needs real area to comment on.
    const box = imageRef.current?.getBoundingClientRect();
    if (!box || rect.width * box.width < MIN_REGION_PX || rect.height * box.height < MIN_REGION_PX)
      return;
    onDraw(rect);
  };

  const startEdit = (
    event: PointerEvent<HTMLElement>,
    index: number,
    origin: Rect,
    kind: 'move' | 'resize',
  ) => {
    if (!drawing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = normalize(event);
    if (start) gestureRef.current = { index, kind, origin, start };
  };
  const handlers = {
    onPointerCancel: () => {
      gestureRef.current = null;
      setDraft(null);
    },
    onPointerUp: endGesture,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (!drawing) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      const start = normalize(event);
      if (start) gestureRef.current = { kind: 'draw', start };
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const point = normalize(event);
      if (!point) return;
      if (gesture.kind === 'draw') {
        setDraft(toRect(gesture.start, point));
        return;
      }
      const { index, origin } = gesture;
      if (gesture.kind === 'move') {
        onUpdate(index, {
          ...origin,
          x: Math.min(Math.max(origin.x + (point.x - gesture.start.x), 0), 1 - origin.width),
          y: Math.min(Math.max(origin.y + (point.y - gesture.start.y), 0), 1 - origin.height),
        });
        return;
      }
      // resize — the origin's top-left corner stays anchored.
      const box = imageRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      onUpdate(index, {
        height: Math.min(Math.max(point.y - origin.y, MIN_REGION_PX / box.height), 1 - origin.y),
        width: Math.min(Math.max(point.x - origin.x, MIN_REGION_PX / box.width), 1 - origin.x),
        x: origin.x,
        y: origin.y,
      });
    },
  };
  return { draft, handlers, imageRef, startEdit };
};
