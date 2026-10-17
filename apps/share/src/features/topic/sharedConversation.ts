import { type ConversationContext } from '@lobechat/types';

import { primeMessageListPage } from '@/services/message/roundCursorPage';
import { type SharedTopicData } from '@/types/topic';

type SharedTopicTarget = Pick<SharedTopicData, 'agentId' | 'groupId' | 'shareId' | 'topicId'>;

/**
 * The conversation a share link shows. The rendered list and the primed read
 * must build it identically, or the list misses the primed page and asks again.
 */
export const toSharedConversationContext = (topic: SharedTopicTarget): ConversationContext => ({
  agentId: topic.agentId ?? '',
  groupId: topic.groupId ?? undefined,
  topicId: topic.topicId,
  topicShareId: topic.shareId,
});

/**
 * Request the share's newest messages now, so they arrive while the
 * conversation chunks are still downloading instead of after they mount.
 */
export const primeSharedTopicMessages = (topic: SharedTopicTarget) => {
  const context = toSharedConversationContext(topic);
  // The list only reads a conversation it can attribute to an agent
  // (`useFetchMessages`); priming any other would be a request nobody takes.
  if (!context.agentId) return;

  primeMessageListPage(context);
};
