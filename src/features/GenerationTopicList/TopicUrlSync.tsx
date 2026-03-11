'use client';

import { useLayoutEffect } from 'react';

import { useQueryState } from '@/hooks/useQueryParam';

import { useGenerationTopicContext } from './StoreContext';

/**
 * Bidirectional sync between URL 'topic' param and store's activeGenerationTopicId.
 *
 * Uses two useLayoutEffect hooks to ensure URL → store sync runs before
 * the store → URL subscription is set up, preventing stale store values
 * from overwriting the URL on remount.
 */
const TopicUrlSync = () => {
  const { useStore } = useGenerationTopicContext();

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

  return null;
};

export default TopicUrlSync;
