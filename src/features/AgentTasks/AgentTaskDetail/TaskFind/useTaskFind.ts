import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearHighlights,
  findKeywordRanges,
  requestReveal,
  scrollRangeIntoView,
  setHighlightRanges,
} from '@/utils/findInDom';

export const TASK_FIND_HIGHLIGHT = {
  active: 'lobe-task-find-active',
  all: 'lobe-task-find',
} as const;

interface UseTaskFindOptions {
  /** The find bar is open; closing it clears every highlight. */
  enabled: boolean;
  keyword: string;
  /**
   * The detail's scroll container: the text searched, and what scrolls to a
   * match. An element, not a ref, so a remount (Retry after a failed load
   * swaps the error view back for a new container) restarts the search there.
   */
  root: HTMLElement | null;
}

/**
 * Find-in-page over the rendered task detail — title aside (a textarea has no
 * text nodes to range over), that is the instruction editor, acceptance,
 * subtasks, deliverables and the activity feed. Matches repaint as the page
 * re-renders (autosave, streaming activity, lazy sections), keeping the user's
 * position when the match under it still exists.
 */
export const useTaskFind = ({ enabled, keyword, root }: UseTaskFindOptions) => {
  const [count, setCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const rangesRef = useRef<Range[]>([]);
  // Steps and repaints read the position synchronously, ahead of the re-render.
  const activeIndexRef = useRef(0);

  const paintActive = useCallback(
    (index: number, scroll: boolean) => {
      const range = rangesRef.current[index];
      setHighlightRanges(TASK_FIND_HIGHLIGHT.active, range ? [range] : [], 2);
      if (!scroll || !range || !root) return;
      // A match inside a clamped "show more" preview opens it first; scroll
      // once the expanded layout has been committed and laid out.
      requestReveal(range);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (range.startContainer.isConnected) scrollRangeIntoView(range, root);
        }),
      );
    },
    [root],
  );

  useEffect(() => {
    const needle = keyword.trim();
    if (!enabled || !needle || !root) {
      rangesRef.current = [];
      setCount(0);
      setActiveIndex(0);
      return;
    }

    let frame: number | undefined;
    const collect = () => findKeywordRanges(root, needle, { includeEditable: true });

    // A new keyword starts at its first match and brings it into view.
    rangesRef.current = collect();
    setHighlightRanges(TASK_FIND_HIGHLIGHT.all, rangesRef.current, 1);
    setCount(rangesRef.current.length);
    activeIndexRef.current = 0;
    setActiveIndex(0);
    paintActive(0, true);

    // Later repaints follow the DOM but never scroll: the user may be reading.
    const repaint = () => {
      frame = undefined;
      rangesRef.current = collect();
      const next = Math.min(activeIndexRef.current, Math.max(rangesRef.current.length - 1, 0));
      setHighlightRanges(TASK_FIND_HIGHLIGHT.all, rangesRef.current, 1);
      setCount(rangesRef.current.length);
      activeIndexRef.current = next;
      setActiveIndex(next);
      paintActive(next, false);
    };
    const observer = new MutationObserver(() => {
      frame ??= requestAnimationFrame(repaint);
    });
    observer.observe(root, { characterData: true, childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearHighlights(Object.values(TASK_FIND_HIGHLIGHT));
    };
  }, [enabled, keyword, paintActive, root]);

  const step = useCallback(
    (delta: 1 | -1) => {
      const total = rangesRef.current.length;
      if (total === 0) return;
      const next = (activeIndexRef.current + delta + total) % total;
      activeIndexRef.current = next;
      setActiveIndex(next);
      paintActive(next, true);
    },
    [paintActive],
  );

  return { activeIndex, count, step };
};
