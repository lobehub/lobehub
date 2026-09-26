import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';

/** Query key `ThreadHydration` reads to reopen a thread in the side panel. */
export const PORTAL_THREAD_QUERY_KEY = 'portalThread';

/**
 * Route that reopens a thread in the side panel of its topic:
 * `/agent/<agentId>/<topicId>?portalThread=<threadId>`.
 */
export const buildThreadSharePath = ({
  agentId,
  threadId,
  topicId,
}: {
  agentId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
}): string | undefined => {
  if (!agentId || !topicId || !threadId) return;

  const query = new URLSearchParams({ [PORTAL_THREAD_QUERY_KEY]: threadId });
  return `${AGENT_CHAT_TOPIC_URL(agentId, topicId)}?${query.toString()}`;
};
