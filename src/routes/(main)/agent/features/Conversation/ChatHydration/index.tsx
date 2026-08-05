'use client';

import { memo } from 'react';
import { useParams } from 'react-router';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useTopicCommentDeepLink } from '@/features/TopicComment/useTopicCommentDeepLink';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

import { useChatRouteSync } from './useChatRouteSync';

// sync outside state to useChatStore
const ChatHydration = memo(() => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const routeTopicId = params.topicId;
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const topicMetadata = useChatStore((s) =>
    routeTopicId ? topicSelectors.getTopicById(routeTopicId)(s)?.metadata : undefined,
  );
  const useFetchTopicLinkedPullRequest = useChatStore((s) => s.useFetchTopicLinkedPullRequest);

  useClearActiveTopicUnread();
  useFetchTopicLinkedPullRequest(activeAgentId ? routeTopicId : undefined, topicMetadata);
  useTopicCommentDeepLink(routeTopicId);
  useChatRouteSync();

  return null;
});

export default ChatHydration;
