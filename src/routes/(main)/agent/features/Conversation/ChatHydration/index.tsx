'use client';

import { type FC, memo } from 'react';
import { useParams } from 'react-router';

import { useClearActiveTopicUnread } from '@/features/Conversation/hooks';
import { useTopicCommentDeepLink } from '@/features/TopicComment/useTopicCommentDeepLink';
import { useChatStore } from '@/store/chat';
import { useChatTopicById } from '@/store/chat/slices/topic/projection';

import { useChatRouteSync } from './useChatRouteSync';

// sync outside state to useChatStore
interface ChatHydrationProps {
  getConversationPath?: (agentId: string) => string;
  getTopicPath?: (agentId: string, topicId: string) => string;
}

const ChatHydration: FC<ChatHydrationProps> = memo(({ getConversationPath, getTopicPath }) => {
  const params = useParams<{ aid?: string; topicId?: string }>();
  const routeTopicId = params.topicId;
  const activeAgentId = useChatStore((s) => s.activeAgentId);
  const topicMetadata = useChatTopicById(routeTopicId)?.metadata;
  const useFetchTopicLinkedPullRequest = useChatStore((s) => s.useFetchTopicLinkedPullRequest);

  useClearActiveTopicUnread();
  useFetchTopicLinkedPullRequest(activeAgentId ? routeTopicId : undefined, topicMetadata);
  useTopicCommentDeepLink(routeTopicId);
  useChatRouteSync({ getConversationPath, getTopicPath });

  return null;
});

export default ChatHydration;
