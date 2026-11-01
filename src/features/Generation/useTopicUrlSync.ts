'use client';

import { useLayoutEffect } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';

export interface TopicUrlSyncStore {
  getState: () => { activeGenerationTopicId: string | null };
  setState: (partial: { activeGenerationTopicId: string | null }) => void;
  subscribe: (listener: (state: { activeGenerationTopicId: string | null }) => void) => () => void;
}

/**
 * Bidirectional sync between URL 'topic' param and store's activeGenerationTopicId.
 *
 * Must run inside the route tree, never in a portal'd sidebar: on Electron the
 * sidebar is rendered by `NavPanel`, which lives outside `TabHost` and is bound
 * to the frozen root router. Writing there lands the param in a different router
 * than the generation page reads, so the workspace never opens after generating.
 *
 * Uses two useLayoutEffect hooks to ensure URL → store sync runs before
 * the store → URL subscription is set up, preventing stale store values
 * from overwriting the URL on remount.
 */
export const useTopicUrlSync = (useStore: TopicUrlSyncStore) => {
  const [topic, setTopic] = useQueryState('topic', { history: 'replace', throttleMs: 500 });

  // URL → store: runs first to ensure store matches URL before subscription
  useLayoutEffect(() => {
    useStore.setState({ activeGenerationTopicId: topic ?? null });
  }, [topic, useStore]);

  // Store → URL: subscribes after URL → store sync
  useLayoutEffect(() => {
    let prevTopicId = useStore.getState().activeGenerationTopicId;
    const unsubscribeTopic = useStore.subscribe((state) => {
      if (state.activeGenerationTopicId !== prevTopicId) {
        prevTopicId = state.activeGenerationTopicId;
        setTopic(state.activeGenerationTopicId || null);
      }
    });

    return () => {
      unsubscribeTopic();
    };
  }, [setTopic, useStore]);
};
