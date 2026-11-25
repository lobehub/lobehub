'use client';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

import { useChatInputStore } from '../store';
import { useTopicId } from './useTopicId';

export const useTopicConversationMode = () => {
  const topicId = useTopicId();
  const committedMode = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.conversationMode : undefined,
  );
  const messageMode = useChatInputStore(
    (s) =>
      s.contextWindow?.history.findLast(
        (message) => message.role === 'user' && message.metadata?.conversationMode,
      )?.metadata?.conversationMode,
  );
  const hasUserTurn = useChatInputStore(
    (s) => s.contextWindow?.history.some((message) => message.role === 'user') ?? false,
  );
  return {
    conversationMode: topicId ? (committedMode ?? messageMode) : undefined,
    isModeLocked: !!topicId && (!!committedMode || !!messageMode || hasUserTurn),
  };
};
