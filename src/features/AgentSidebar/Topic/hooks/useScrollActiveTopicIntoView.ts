import { useEffect, useRef } from 'react';

/**
 * Reveals each route-selected topic once after its row becomes available.
 *
 * The list readiness signal may also change for unrelated accordion or ordering updates. Tracking
 * only successful reveals prevents those updates from pulling the sidebar back to the active row.
 */
export const useScrollActiveTopicIntoView = (activeTopicId?: string | null, ready?: unknown) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const revealedTopicIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!activeTopicId || revealedTopicIdRef.current === activeTopicId) return;

    const activeRow = containerRef.current?.querySelector<HTMLElement>(
      `[data-topic-id="${CSS.escape(activeTopicId)}"]`,
    );
    if (!activeRow) return;

    activeRow.scrollIntoView({ block: 'nearest' });
    revealedTopicIdRef.current = activeTopicId;
  }, [activeTopicId, ready]);

  return containerRef;
};
