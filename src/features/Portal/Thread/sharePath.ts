import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';

/** Query key `ThreadHydration` reads to reopen a thread in the side panel. */
export const PORTAL_THREAD_QUERY_KEY = 'portalThread';

/**
 * Route back to where a run actually happened: the group conversation it belongs
 * to (`/group/<chatGroupId>/<topicId>`) or its agent topic, with the thread
 * reopened (`?portalThread=<threadId>`) when it ran inside one.
 *
 * A group's turns and an agent's turns are different conversations — routing a
 * group turn through the agent route opens the supervisor's own transcript, and
 * dropping the thread lands on the topic's main one.
 */
export const buildOperationSourcePath = ({
  agentId,
  chatGroupId,
  threadId,
  topicId,
}: {
  agentId?: null | string;
  chatGroupId?: null | string;
  threadId?: null | string;
  topicId?: null | string;
}): string | undefined => {
  if (!topicId) return;

  const topicPath = chatGroupId
    ? GROUP_CHAT_TOPIC_URL(chatGroupId, topicId)
    : agentId
      ? AGENT_CHAT_TOPIC_URL(agentId, topicId)
      : undefined;
  if (!topicPath) return;
  if (!threadId) return topicPath;

  const query = new URLSearchParams({ [PORTAL_THREAD_QUERY_KEY]: threadId });
  return `${topicPath}?${query.toString()}`;
};

/**
 * Route that reopens a thread in the side panel of its topic:
 * `/agent/<agentId>/<topicId>?portalThread=<threadId>`, or
 * `/group/<groupId>/<topicId>?portalThread=<threadId>` inside a group, where
 * `agentId` is the supervisor and would open a different conversation.
 *
 * Returns nothing without a thread — callers share a *thread*, so a topic-only
 * destination is not one; `buildOperationSourcePath` is the one that also takes
 * the plain topic.
 */
export const buildThreadSharePath = (options: {
  agentId?: null | string;
  groupId?: null | string;
  threadId?: null | string;
  topicId?: null | string;
}): string | undefined =>
  options.threadId
    ? buildOperationSourcePath({
        agentId: options.agentId,
        chatGroupId: options.groupId,
        threadId: options.threadId,
        topicId: options.topicId,
      })
    : undefined;
