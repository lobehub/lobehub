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

const EDITABLE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
const CONTROL_TAGS = new Set(['A', 'BUTTON']);

/**
 * Whether the focused target owns this key itself, so paging the document
 * instead would take it away from the control the reader is actually using.
 * Ownership is per key: a field or editable region owns everything typed
 * into it, including PageUp/PageDown, which move its own caret. A button or
 * link owns Space (its activation) and nothing else — PageUp/PageDown on a
 * focused card action have no meaning to the control and cannot page the
 * sibling document pane by default, so they are still forwarded.
 */
export const isKeyOwnedByTarget = (
  key: string,
  target: EventTarget | null,
  host: HTMLElement,
): boolean => {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== host) {
    if (node.isContentEditable || EDITABLE_TAGS.has(node.tagName)) return true;
    if (key === ' ' && (CONTROL_TAGS.has(node.tagName) || node.hasAttribute('role'))) return true;
    node = node.parentElement;
  }
  return false;
};

/**
 * The comments panel is not a scroll container — its cards ride along with
 * the document (see `useGutterLayout`). A wheel, touch drag, or PageDown/
 * Space over the panel would therefore do nothing, which reads as a stuck
 * column; hand the gesture's distance to `scrollBy` instead, which scrolls
 * the document and, past its ends, the panel's own overhang.
 *
 * Bound natively rather than through React so the events can be cancelled:
 * React registers wheel and touch listeners as passive.
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

    // A one-finger drag is the touch equivalent of a wheel: the delta is the
    // distance the finger crossed since the last move, in the direction
    // content should follow it (finger moves up, content scrolls down).
    let touchY: number | undefined;
    const handleTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (touchY === undefined || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const delta = touchY - y;
      touchY = y;
      if (delta === 0 || innerScrollerTakesIt(event.target, host, delta)) return;
      event.preventDefault();
      scrollBy(delta);
    };
    const handleTouchEnd = () => {
      touchY = undefined;
    };

    // Space and PageUp/PageDown are how a reader without a pointer pages a
    // scroll region once focus lands inside it; skip a key the target already
    // owns itself (a button's Space activation, anything typed into a field).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isKeyOwnedByTarget(event.key, event.target, host)) return;
      let direction: -1 | 1 | undefined;
      if (event.key === 'PageDown') direction = 1;
      else if (event.key === 'PageUp') direction = -1;
      else if (event.key === ' ') direction = event.shiftKey ? -1 : 1;
      if (!direction) return;
      event.preventDefault();
      scrollBy(direction * host.clientHeight);
    };

    host.addEventListener('wheel', handleWheel, { passive: false });
    host.addEventListener('touchstart', handleTouchStart, { passive: true });
    host.addEventListener('touchmove', handleTouchMove, { passive: false });
    host.addEventListener('touchend', handleTouchEnd, { passive: true });
    host.addEventListener('keydown', handleKeyDown);
    return () => {
      host.removeEventListener('wheel', handleWheel);
      host.removeEventListener('touchstart', handleTouchStart);
      host.removeEventListener('touchmove', handleTouchMove);
      host.removeEventListener('touchend', handleTouchEnd);
      host.removeEventListener('keydown', handleKeyDown);
    };
  }, [hostRef, scrollBy]);
};
