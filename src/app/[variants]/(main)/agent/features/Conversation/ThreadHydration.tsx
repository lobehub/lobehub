'use client';

import { memo, useEffect, useLayoutEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useQueryState } from '@/hooks/useQueryParam';
import { useChatStore } from '@/store/chat';

// sync outside state to useChatStore
const ThreadHydration = memo(() => {
  const useStoreUpdater = createStoreUpdater(useChatStore);

  // two-way bindings the topic params to chat store
  const [portalThread, setThread] = useQueryState('portalThread');
  useStoreUpdater('portalThreadId', portalThread!);

  useLayoutEffect(() => {
    const unsubscribe = useChatStore.subscribe(
      (s) => s.portalThreadId,
      (state) => {
        setThread(!state ? null : state);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [setThread]); // ✅ 现在 setValue 是稳定的，可以安全地添加到依赖数组

  // should open portal automatically when portalThread is set
  useEffect(() => {
    if (!!portalThread && !useChatStore.getState().showPortal) {
      useChatStore.getState().togglePortal(true);
    }
  }, [portalThread]);

  const activeTopicId = useChatStore((s) => s.activeTopicId);

  useFetchThreads(activeTopicId);

  return null;
});

export default ThreadHydration;
