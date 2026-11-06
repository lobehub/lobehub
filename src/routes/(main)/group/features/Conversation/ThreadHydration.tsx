'use client';

import { memo } from 'react';

import { usePortalThreadHydration } from '@/features/Portal/Thread/usePortalThreadHydration';
import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useChatStore } from '@/store/chat';

// sync outside state to useChatStore
const ThreadHydration = memo(() => {
  usePortalThreadHydration();

  const activeTopicId = useChatStore((s) => s.activeTopicId);

  useFetchThreads(activeTopicId);

  return null;
});

export default ThreadHydration;
