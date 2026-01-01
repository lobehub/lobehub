'use client';

import { useLayoutEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useQueryState } from '@/hooks/useQueryParam';
import { useImageStore } from '@/store/image';

/**
 * 双向绑定 url 的 topic 参数到 image store 的 activeGenerationTopicId
 */
const TopicUrlSync = () => {
  const useStoreUpdater = createStoreUpdater(useImageStore);

  const [topic, setTopic] = useQueryState('topic', { history: 'replace', throttleMs: 500 });
  useStoreUpdater('activeGenerationTopicId', topic);

  useLayoutEffect(() => {
    const unsubscribeTopic = useImageStore.subscribe(
      (s) => s.activeGenerationTopicId,
      (state) => {
        setTopic(state || null);
      },
    );

    return () => {
      unsubscribeTopic();
    };
  }, [setTopic]);

  // 这个组件不渲染任何UI，仅用于同步状态
  return null;
};

TopicUrlSync.displayName = 'TopicUrlSync';

export default TopicUrlSync;
