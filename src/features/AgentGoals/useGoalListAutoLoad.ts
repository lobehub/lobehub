import { useCallback, useEffect, useState } from 'react';

/** Start revealing the next rows a little before the reader reaches the end. */
const ROOT_MARGIN = '240px 0px';

/**
 * The list scrolls inside the page container, not the window. Observing against
 * the viewport would clip the sentinel at that container's edge and ignore the
 * margin, so the next rows would only appear once the reader hit the very end.
 */
const findScrollParent = (node: HTMLElement): HTMLElement | null => {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll|overlay/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
};

/**
 * Reveals the next window of goal rows when the sentinel below the list nears
 * the viewport, replacing a manual "Load more" button.
 *
 * `revision` is the current window size: the observer is re-created each time
 * the window grows, so a reader already parked at the bottom keeps revealing
 * rows instead of stalling on an intersection that never changes again.
 */
export const useGoalListAutoLoad = (hasMore: boolean, loadMore: () => void, revision: number) => {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => setSentinel(node), []);

  useEffect(() => {
    if (!sentinel || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') {
      loadMore();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(({ isIntersecting }) => isIntersecting)) loadMore();
      },
      { root: findScrollParent(sentinel), rootMargin: ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, revision, sentinel]);

  return sentinelRef;
};
