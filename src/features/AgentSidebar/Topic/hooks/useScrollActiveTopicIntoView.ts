import { useEffect, useRef } from 'react';

/** Keeps a route-selected topic visible when it is injected outside the normal sidebar page. */
export const useScrollActiveTopicIntoView = (activeTopicId?: string | null, ready?: unknown) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackedTopicIdRef = useRef<string | null | undefined>(undefined);
  const hasRevealedTrackedTopicRef = useRef(false);

  useEffect(() => {
    if (trackedTopicIdRef.current !== activeTopicId) {
      trackedTopicIdRef.current = activeTopicId;
      hasRevealedTrackedTopicRef.current = false;
    }
    if (!activeTopicId || hasRevealedTrackedTopicRef.current) return;

    const activeRow = containerRef.current?.querySelector<HTMLElement>(
      `[data-topic-id="${CSS.escape(activeTopicId)}"]`,
    );
    if (!activeRow) return;

    activeRow.scrollIntoView({ block: 'nearest' });
    hasRevealedTrackedTopicRef.current = true;
  }, [activeTopicId, ready]);

  return containerRef;
};
