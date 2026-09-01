import { useEffect, useRef } from 'react';

/** Keeps a route-selected topic visible when it is injected outside the normal sidebar page. */
export const useScrollActiveTopicIntoView = (activeTopicId?: string | null, ready?: unknown) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeTopicId) return;

    const activeRow = containerRef.current?.querySelector<HTMLElement>(
      `[data-topic-id="${CSS.escape(activeTopicId)}"]`,
    );
    activeRow?.scrollIntoView({ block: 'nearest' });
  }, [activeTopicId, ready]);

  return containerRef;
};
