import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Activity entries mounted per page. A scheduled task can accumulate hundreds
 * of runs and comments, each a heavy card (markdown, run summary); mounting
 * them all at once is what makes a long-lived task's page freeze. The feed is
 * newest-first, so the first page is the part a reader actually came for.
 */
export const ACTIVITY_PAGE_SIZE = 20;

export const sliceActivityPage = <T>(items: T[], visibleCount: number) => {
  const visible = items.length > visibleCount ? items.slice(0, visibleCount) : items;
  return { remaining: items.length - visible.length, visible };
};

/**
 * Newest-first paging for the activity feed: shows `ACTIVITY_PAGE_SIZE`
 * entries, then appends another page when the sentinel below the list scrolls
 * into view (or the fallback button is pressed). Resets when the task changes.
 */
export const useActivityPaging = <T>(items: T[], resetKey: string | undefined) => {
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);

  // Reset during render (not in an effect) so a newly opened task never
  // mounts the previous task's expanded page for a frame.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setVisibleCount(ACTIVITY_PAGE_SIZE);
  }

  const { remaining, visible } = sliceActivityPage(items, visibleCount);

  const loadMore = useCallback(() => setVisibleCount((n) => n + ACTIVITY_PAGE_SIZE), []);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = remaining > 0;
  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
    // `visibleCount` re-arms the observer after each page: if the sentinel is
    // still in view (short cards), the fresh observer fires again.
  }, [hasMore, loadMore, visibleCount]);

  return { loadMore, remaining, sentinelRef, visible };
};
