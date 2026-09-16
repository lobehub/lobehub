'use client';

import type { RefObject } from 'react';
import { useEffect } from 'react';

/** Pixels per line for `DOM_DELTA_LINE` wheels (Firefox with a mouse wheel). */
const LINE_HEIGHT = 16;

const deltaToPixels = (event: WheelEvent, host: HTMLElement) => {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE: {
      return event.deltaY * LINE_HEIGHT;
    }
    case WheelEvent.DOM_DELTA_PAGE: {
      return event.deltaY * host.clientHeight;
    }
    default: {
      return event.deltaY;
    }
  }
};

/** Whether an element between the event target and the host can still scroll in this direction. */
const innerScrollerTakesIt = (target: EventTarget | null, host: HTMLElement, deltaY: number) => {
  let node = target instanceof Element ? target : null;
  while (node && node !== host) {
    const { overflowY } = getComputedStyle(node);
    const scrolls = overflowY === 'auto' || overflowY === 'scroll';
    if (scrolls && node.scrollHeight > node.clientHeight) {
      const atEnd =
        deltaY > 0
          ? node.scrollTop + node.clientHeight >= node.scrollHeight - 1
          : node.scrollTop <= 0;
      if (!atEnd) return true;
    }
    node = node.parentElement;
  }
  return false;
};

/**
 * The comments panel is not a scroll container — its cards ride along with
 * the document (see `useGutterLayout`). A wheel over the panel would
 * therefore do nothing, which reads as a stuck column; hand its distance to
 * `scrollBy` instead, which scrolls the document and, past its ends, the
 * panel's own overhang.
 *
 * Bound natively rather than through React so the event can be cancelled:
 * React registers wheel listeners as passive.
 */
export const useForwardWheel = (
  hostRef: RefObject<HTMLElement | null>,
  scrollBy: (deltaPixels: number) => void,
) => {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handleWheel = (event: WheelEvent) => {
      // Ctrl+wheel is the browser's zoom gesture (and how a trackpad pinch is
      // reported); hijacking it into a document scroll would block zooming
      // whenever the pointer happens to be over the panel.
      if (event.deltaY === 0 || event.defaultPrevented || event.ctrlKey) return;
      if (innerScrollerTakesIt(event.target, host, event.deltaY)) return;
      event.preventDefault();
      scrollBy(deltaToPixels(event, host));
    };
    host.addEventListener('wheel', handleWheel, { passive: false });
    return () => host.removeEventListener('wheel', handleWheel);
  }, [hostRef, scrollBy]);
};
