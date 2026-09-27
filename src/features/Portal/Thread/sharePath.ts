import { AGENT_CHAT_TOPIC_URL, GROUP_CHAT_TOPIC_URL } from '@lobechat/const';

/** Query key `ThreadHydration` reads to reopen a thread in the side panel. */
export const PORTAL_THREAD_QUERY_KEY = 'portalThread';

/**
 * Route that reopens a thread in the side panel of its topic:
 * `/agent/<agentId>/<topicId>?portalThread=<threadId>`, or
 * `/group/<groupId>/<topicId>?portalThread=<threadId>` inside a group, where
 * `agentId` is the supervisor and would open a different conversation.
 */
export const buildThreadSharePath = ({
  agentId,
  groupId,
  threadId,
  topicId,
}: {
  agentId?: string | null;
  groupId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}): string | undefined => {
  if (!topicId || !threadId) return;

  const topicPath = groupId
    ? GROUP_CHAT_TOPIC_URL(groupId, topicId)
    : agentId
      ? AGENT_CHAT_TOPIC_URL(agentId, topicId)
      : undefined;
  if (!topicPath) return;

  const query = new URLSearchParams({ [PORTAL_THREAD_QUERY_KEY]: threadId });
  return `${topicPath}?${query.toString()}`;
};
