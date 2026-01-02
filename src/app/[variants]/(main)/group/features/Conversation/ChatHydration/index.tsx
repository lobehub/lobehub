'use client';

import { memo, useLayoutEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const useStoreUpdater = createStoreUpdater(useChatStore);

  // two-way bindings the topic params to chat store
  const [topic, setTopic] = useQueryState('topic', { history: 'replace', throttleMs: 500 });
  const [thread, setThread] = useQueryState('thread', { history: 'replace', throttleMs: 500 });
  useStoreUpdater('activeTopicId', topic!);
  useStoreUpdater('activeThreadId', thread!);

  useLayoutEffect(() => {
    const unsubscribeTopic = useChatStore.subscribe(
      (s) => s.activeTopicId,
      (state) => {
        setTopic(!state ? null : state);
      },
    );
    const unsubscribeThread = useChatStore.subscribe(
      (s) => s.activeThreadId,
      (state) => {
        setThread(!state ? null : state);
      },
    );

    return () => {
      unsubscribeTopic();
      unsubscribeThread();
    };
  }, [setTopic, setThread]); // ✅ 现在 setValue 是稳定的，可以安全地添加到依赖数组

  return null;
});

export default ChatHydration;
