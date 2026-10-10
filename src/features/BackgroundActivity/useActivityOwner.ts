import { useTopicTitle } from './ActivityTable';
import { useAgentMeta } from './AgentName';
import type { Activity } from './state';

/**
 * Agent and topic titles for an activity, fetched when not cached yet. Alerts read this from
 * inside the toast: they fire once per episode, so a snapshot taken before hydration would never
 * be corrected.
 */
export const useActivityOwner = ({ agentId, topicId }: Pick<Activity, 'agentId' | 'topicId'>) => ({
  agent: useAgentMeta(agentId).title,
  topic: useTopicTitle(topicId),
});
