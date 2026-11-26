import { conversationSelectors, useConversationStore } from '@/features/Conversation';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/slices/topic/selectors';

/**
 * The topic this panel's conversation is on — read from its own context, not
 * the store's active topic. Other hosts on the goal page (the task manager
 * panel) move that one, and a pinned supervision record must keep its title
 * and topic menu when they do.
 */
export const useConversationTopic = () => {
  const topicId = useConversationStore(conversationSelectors.topicId);
  return useChatStore((s) => (topicId ? topicSelectors.getTopicById(topicId)(s) : undefined));
};
