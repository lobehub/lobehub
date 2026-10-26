'use client';

import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';

/**
 * Coalescing window between "a row became visible" and the prefetch. Rows paint
 * in bursts (initial mount, scrolling a group open, switching agents), so
 * waiting one frame-ish lets a whole screenful become a single batch call
 * instead of one call per row.
 */
const FLUSH_DELAY = 150;

const pendingTopicIds = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const flush = () => {
  flushTimer = undefined;
  if (pendingTopicIds.size === 0) return;

  const topicIds = [...pendingTopicIds];
  pendingTopicIds.clear();

  const { activeAgentId, activeGroupId, prefetchTopicMessagesBatch } = useChatStore.getState();
  void prefetchTopicMessagesBatch({ agentId: activeAgentId, groupId: activeGroupId, topicIds });
};

const enqueue = (topicId: string) => {
  if (pendingTopicIds.has(topicId)) return;

  pendingTopicIds.add(topicId);
  flushTimer ??= setTimeout(flush, FLUSH_DELAY);
};

/** Drop a queued flush — test seam; the queue is module-level by design. */
export const resetVisibleTopicPrefetchQueue = () => {
  pendingTopicIds.clear();
  if (flushTimer !== undefined) clearTimeout(flushTimer);
  flushTimer = undefined;
};

/**
 * Prefetch a topic's transcript once its row is visible, and stop watching it
 * afterwards.
 *
 * The row registers itself rather than the list walking its children: the same
 * component renders inside the flat / by-time / by-project / by-status
 * groupings and the group sidebar, so one call site covers every mode. The
 * observer uses the viewport as its root (the sidebar is the scroller) and a
 * `rootMargin` so the read starts just before the row is actually on screen.
 *
 * "Is it already local?" is deliberately NOT answered here — the store action
 * owns that check, together with the batch cap and the per-topic eligibility
 * rules (client-minted, running, already loaded).
 */
export const useVisibleTopicPrefetch = <T extends HTMLElement = HTMLDivElement>(
  topicId?: string | null,
) => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !topicId) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        enqueue(topicId);
        // One warm-up per mount is enough; a later re-entry finds the rows
        // already in the store.
        observer.disconnect();
      },
      { rootMargin: '200px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [topicId]);

  return ref;
};
