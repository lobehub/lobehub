import { useCallback, useEffect, useRef, useState } from 'react';

/** Rows a card shows up front, and how many more each scroll to the end reveals. */
export const ROW_BATCH = 20;

/**
 * Reveal rows in batches as the user scrolls a card to its end, so a long
 * list stays cheap to mount but is never cut off. Attach `sentinelRef` to an
 * element after the last rendered row; it is only needed while `hasMore`.
 */
export const useIncrementalRows = (total: number, enabled: boolean) => {
  const [shown, setShown] = useState(ROW_BATCH);
  const observerRef = useRef<IntersectionObserver | undefined>(undefined);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = undefined;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    // The scroll container is the card body, so the default (viewport) root still
    // sees the sentinel as hidden until the body is scrolled to it.
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown((count) => count + ROW_BATCH);
      }
    });
    observerRef.current.observe(node);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const count = enabled ? Math.min(shown, total) : total;
  return { count, hasMore: enabled && count < total, sentinelRef };
};
