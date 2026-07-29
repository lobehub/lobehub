import { useEffect, useRef } from 'react';

/**
 * Scroll the active thread row into view inside the capped (max-height) thread
 * list.
 *
 * When a topic is opened or reloaded with `activeThreadId` restored from the
 * `?thread=` query and that thread sits below the first visible rows, the
 * scroll container mounts at `scrollTop = 0`. Since the topic row itself is not
 * highlighted while a thread is active, the user lands on a valid thread with no
 * visible selection in the sidebar. This nudges the capped list so the active
 * row is visible.
 *
 * Returns a ref to attach to the scroll container. Each thread row must carry a
 * `data-thread-id` attribute so the active row can be located.
 *
 * @param activeThreadId - the currently active thread id (from the store)
 * @param ready - a value that changes once the rows have mounted (e.g.
 *   `threads.length`); ensures the effect re-runs after the list renders, not
 *   only when `activeThreadId` changes, so a restored thread still scrolls into
 *   view once the async-fetched list arrives.
 */
export const useScrollActiveThreadIntoView = (activeThreadId?: string | null, ready?: unknown) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeThreadId) return;
    const container = containerRef.current;
    if (!container) return;

    const activeRow = container.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(activeThreadId)}"]`,
    );
    // `block: 'nearest'` only scrolls when the row is out of view, so an
    // already-visible selection (e.g. the first few rows) stays put.
    activeRow?.scrollIntoView({ block: 'nearest' });
  }, [activeThreadId, ready]);

  return containerRef;
};
