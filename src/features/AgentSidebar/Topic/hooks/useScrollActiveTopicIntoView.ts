import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';

let sidebarActivatedTopicId: string | undefined;

/**
 * Records that the user opened this topic from a sidebar row. The row is already under the
 * pointer, and activating it can move the row to another status group, so revealing it
 * afterwards would drag the list away from where the user is working.
 */
export const markSidebarTopicActivation = (topicId: string) => {
  sidebarActivatedTopicId = topicId;
};

/**
 * Reveals each route-selected topic once after its row becomes available.
 *
 * Only activations that come from outside the list (search results, deep links, reload) are
 * revealed. A row the user clicked, or a topic this client created for its first send, is
 * already where the user's attention is; revealing it would scroll the sidebar to wherever the
 * row ends up in the current grouping, which is often the bottom.
 *
 * The list readiness signal may also change for unrelated accordion or ordering updates. Tracking
 * only successful reveals prevents those updates from pulling the sidebar back to the active row.
 */
export const useScrollActiveTopicIntoView = (activeTopicId?: string | null, ready?: unknown) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const revealedTopicIdRef = useRef<string | undefined>(undefined);
  const isClientCreated = useChatStore(
    (s) => !!activeTopicId && s.creatingTopicIds.includes(activeTopicId),
  );

  useEffect(() => {
    if (!activeTopicId || revealedTopicIdRef.current === activeTopicId) return;

    const fromSidebar = sidebarActivatedTopicId === activeTopicId;
    sidebarActivatedTopicId = undefined;

    if (fromSidebar || isClientCreated) {
      revealedTopicIdRef.current = activeTopicId;
      return;
    }

    const activeRow = containerRef.current?.querySelector<HTMLElement>(
      `[data-topic-id="${CSS.escape(activeTopicId)}"]`,
    );
    if (!activeRow) return;

    activeRow.scrollIntoView({ block: 'nearest' });
    revealedTopicIdRef.current = activeTopicId;
  }, [activeTopicId, isClientCreated, ready]);

  return containerRef;
};
