import { useCallback, useEffect, useState } from 'react';

/** How long the skeleton stays up after a view-mode switch (ms). */
export const VIEW_TRANSITION_MS = 100;

/**
 * Brief skeleton between list / masonry view switches.
 *
 * Completion depends only on time, never on the list having rows: a surface
 * whose first fetch failed has none, and gating on them would leave the
 * skeleton up instead of the network error until the modal remounts. A list
 * that is still loading keeps its own skeleton through `isLoading`.
 */
export const useViewTransition = (viewMode: string) => {
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (!isTransitioning) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setIsTransitioning(false), VIEW_TRANSITION_MS);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [isTransitioning, viewMode]);

  const startTransition = useCallback(() => setIsTransitioning(true), []);

  return { isTransitioning, startTransition };
};
