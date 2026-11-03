import type { AgentState } from '@lobechat/agent-runtime';

import type { SteerQueueScope } from '@/server/services/redis/steerQueue';

/**
 * The queue a run's owner fills behind it: that user's follow-ups on the run's
 * conversation surface, or `undefined` for a run nobody types behind — a child
 * run (sub-agent, group member) or one with no topic.
 */
export const steerQueueScopeOf = (
  state: AgentState,
  userId: string,
): SteerQueueScope | undefined => {
  const origin = state.origin;
  if (!origin?.topicId) return;
  if (origin.lineage?.isSubAgent || origin.lineage?.parentOperationId) return;

  return { threadId: origin.threadId ?? null, topicId: origin.topicId, userId };
};
