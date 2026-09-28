import type { TouchEvent } from 'react';
import { useLayoutEffect, useRef } from 'react';

import { ZOOM_STEPS } from '../Review/rejectDraft';
import { anchoredScroll, pinchedZoom, touchDistance, touchMidpoint } from './pinchZoom';

interface UsePinchZoomInput {
  /** The scroll container the image lives in — the pan surface the zoom anchors against. */
  node: HTMLElement | null;
  /** Absent means the host does not offer pinch (the desktop stage). */
  onZoom?: (zoom: number) => void;
  zoom: number;
}

/**
 * Two fingers on the stage change the zoom; the point between them stays put.
 *
 * The zoom itself lives in the review model (the buttons share it), so this
 * only reports the zoom a pinch has reached and, once the host has re-rendered
 * the image at that size, moves the scroll so the pinched spot does not jump.
 * The browser's own page zoom is switched off by the host's `touch-action`.
 */
export const usePinchZoom = ({ node, onZoom, zoom }: UsePinchZoomInput) => {
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const applied = useRef(zoom);

  // The width the zoom multiplies is set by React on the next render, so the
  // scroll correction has to wait for that layout — hence an effect on `zoom`,
  // not a write inside the touch handler.
  useLayoutEffect(() => {
    const ratio = zoom / applied.current;
    applied.current = zoom;
    const at = anchor.current;
    anchor.current = null;
    if (!node || !at || ratio === 1) return;
    node.scrollLeft = anchoredScroll(node.scrollLeft, at.x, ratio);
    node.scrollTop = anchoredScroll(node.scrollTop, at.y, ratio);
  }, [node, zoom]);

  if (!onZoom) return { handlers: {} };

  const fingers = (event: TouchEvent) => {
    if (event.touches.length < 2) return null;
    const [a, b] = [event.touches[0], event.touches[1]];
    return {
      distance: touchDistance({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
      midpoint: touchMidpoint({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }),
    };
  };

  return {
    handlers: {
      onTouchCancel: () => {
        pinch.current = null;
      },
      onTouchEnd: (event: TouchEvent) => {
        if (event.touches.length < 2) pinch.current = null;
      },
      onTouchMove: (event: TouchEvent) => {
        const start = pinch.current;
        const now = fingers(event);
        if (!start || !now) return;
        const next = pinchedZoom(
          start.zoom,
          start.distance,
          now.distance,
          ZOOM_STEPS[0],
          ZOOM_STEPS.at(-1)!,
        );
        if (next === zoom) return;
        const box = node?.getBoundingClientRect();
        anchor.current = box ? { x: now.midpoint.x - box.left, y: now.midpoint.y - box.top } : null;
        onZoom(next);
      },
      onTouchStart: (event: TouchEvent) => {
        const now = fingers(event);
        // The second finger starts a pinch from wherever the zoom is now —
        // the buttons may have moved it since the last pinch.
        if (now) pinch.current = { distance: now.distance, zoom };
      },
    },
  };
};
