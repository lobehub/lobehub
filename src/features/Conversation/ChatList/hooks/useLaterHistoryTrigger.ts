import type { KeyboardEvent, RefObject, TouchEvent, WheelEvent } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import type { VListHandle } from 'virtua';

/**
 * Distance from the end of the loaded rows (px) under which a downward gesture
 * appends the next rounds of a forward transcript. `loadLaterMessages`
 * self-guards against duplicate and exhausted loads, so firing it per gesture
 * is safe.
 */
export const LATER_HISTORY_TRIGGER_PX = 200;

const DOWNWARD_KEYS = new Set(['ArrowDown', 'End', 'PageDown']);

interface UseLaterHistoryTriggerOptions {
  enabled: boolean;
  loadLaterMessages: () => Promise<void>;
  virtuaRef: RefObject<VListHandle | null>;
}

/**
 * The forward counterpart of `useEarlierHistoryTrigger`: a downward gesture
 * near the end appends the next page. Gestures fire whether or not the list can
 * scroll, so a first page shorter than the viewport still continues on the
 * reader's first wheel or swipe; nothing loads without one.
 */
export const useLaterHistoryTrigger = ({
  enabled,
  loadLaterMessages,
  virtuaRef,
}: UseLaterHistoryTriggerOptions) => {
  const touchStartYRef = useRef<number | null>(null);

  const requestIfNearEnd = useCallback(() => {
    const ref = virtuaRef.current;
    if (!enabled || !ref) return;
    if (ref.scrollSize - ref.scrollOffset - ref.viewportSize >= LATER_HISTORY_TRIGGER_PX) return;
    void loadLaterMessages();
  }, [enabled, loadLaterMessages, virtuaRef]);

  const onUserScroll = requestIfNearEnd;

  const onWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      if (event.deltaY > 0) requestIfNearEnd();
    },
    [requestIfNearEnd],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (DOWNWARD_KEYS.has(event.key)) requestIfNearEnd();
    },
    [requestIfNearEnd],
  );

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const onTouchMove = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY !== null && currentY !== undefined && currentY < startY) requestIfNearEnd();
    },
    [requestIfNearEnd],
  );

  return useMemo(
    () => ({ onKeyDown, onTouchMove, onTouchStart, onUserScroll, onWheel }),
    [onKeyDown, onTouchMove, onTouchStart, onUserScroll, onWheel],
  );
};
