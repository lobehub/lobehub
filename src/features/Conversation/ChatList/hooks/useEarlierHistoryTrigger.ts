import type { KeyboardEvent, RefObject, TouchEvent, WheelEvent } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import type { VListHandle } from 'virtua';

/**
 * Distance from the very top (px) under which an upward gesture fetches one
 * round-aligned page of history older than the server's newest-first window.
 * `loadEarlierMessages` self-guards against duplicate and exhausted loads, so
 * firing it per gesture is safe.
 */
export const EARLIER_HISTORY_TRIGGER_PX = 200;

const UPWARD_KEYS = new Set(['ArrowUp', 'Home', 'PageUp']);

interface UseEarlierHistoryTriggerOptions {
  loadEarlierMessages: () => Promise<void>;
  virtuaRef: RefObject<VListHandle | null>;
}

/**
 * Fetch pre-window history on upward *intent* near the top, not only on scroll
 * events. A long topic's last round often collapses into a single workflow
 * block, leaving a list shorter than its viewport: it can never scroll, so a
 * scroll-only trigger would leave the older history unreachable. Wheel, touch
 * pull, and upward navigation keys fire whether or not the list moves — which
 * also lets a user retry at scrollTop 0 after a failed page, where further
 * wheel-ups produce no scroll event either.
 */
export const useEarlierHistoryTrigger = ({
  loadEarlierMessages,
  virtuaRef,
}: UseEarlierHistoryTriggerOptions) => {
  const touchStartYRef = useRef<number | null>(null);

  const requestIfNearTop = useCallback(() => {
    const ref = virtuaRef.current;
    if (!ref || ref.scrollOffset >= EARLIER_HISTORY_TRIGGER_PX) return;
    void loadEarlierMessages();
  }, [loadEarlierMessages, virtuaRef]);

  /** A scroll event that carries real user intent (programmatic mount/restore scrolls do not). */
  const onUserScroll = requestIfNearTop;

  const onWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (event.deltaY < 0) requestIfNearTop();
    },
    [requestIfNearTop],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (UPWARD_KEYS.has(event.key)) requestIfNearTop();
    },
    [requestIfNearTop],
  );

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      // Dragging the finger downward scrolls the content up, toward older history.
      if (startY !== null && currentY !== undefined && currentY > startY) requestIfNearTop();
    },
    [requestIfNearTop],
  );

  return useMemo(
    () => ({ onKeyDown, onTouchMove, onTouchStart, onUserScroll, onWheel }),
    [onKeyDown, onTouchMove, onTouchStart, onUserScroll, onWheel],
  );
};
