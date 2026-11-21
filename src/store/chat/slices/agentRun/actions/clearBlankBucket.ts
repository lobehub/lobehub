import type { ConversationContext } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

/**
 * Empty an agent's blank (`_new`) conversation bucket once an isolated send
 * (Home composer, forwarding) has created its topic. Isolated callers move on to
 * the topic themselves and never switch the store to it, so nothing else clears
 * the optimistic pair they showed there. Left behind, the next blank send of the
 * agent (e.g. a direct @Agent) sent those rows as its new topic's messages and
 * moved them out of the topic they belong to.
 */
export const clearBlankConversationBucket = (
  get: () => ChatStore,
  { agentId, groupId, scope }: Pick<ConversationContext, 'agentId' | 'groupId' | 'scope'>,
) =>
  get().replaceMessages([], {
    action: 'clearBlankConversationBucket',
    context: { agentId, groupId, scope: scope ?? (groupId ? 'group' : 'main'), topicId: null },
  });

/**
 * Leave the blank bucket a send came from once the send has created its topic.
 *
 * An isolated send never switches the store to its topic, so only its bucket
 * is emptied (see `clearBlankConversationBucket`). Any other send switches to
 * the topic and clears the blank bucket it came from, not the current view: the
 * user may be viewing a different conversation by now. If the user navigated
 * to another topic while the persistence round-trip was in flight, they stay
 * there and the new topic's unread badge surfaces the reply. Both the minted
 * and the persisted topic id count as "still here", since the optimistic topic
 * is re-keyed from the former to the latter.
 */
export const leaveBlankConversationBucket = async (
  get: () => ChatStore,
  context: Pick<ConversationContext, 'agentId' | 'groupId' | 'scope' | 'topicId'>,
  { isolated, topicId }: { isolated?: boolean; topicId: string },
) => {
  if (isolated) return clearBlankConversationBucket(get, context);

  await get().switchTopic(topicId, {
    clearNewKey: true,
    clearNewKeyContext: { agentId: context.agentId, groupId: context.groupId },
    onlyIfActiveTopicIn: [context.topicId ?? null, topicId],
    skipRefreshMessage: true,
  });
};
