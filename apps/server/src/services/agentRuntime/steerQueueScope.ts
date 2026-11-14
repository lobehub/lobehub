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

/**
 * The queue a running `callSubAgent` child reads steer instructions from: its
 * isolation thread on the parent's topic. The parent agent fills it when it
 * sends the child another instruction mid-run (`callSubAgent({ subAgentId })`);
 * nobody else types behind a child run. `undefined` for a top-level run.
 */
export const subAgentSteerQueueScopeOf = (
  state: AgentState,
  userId: string,
): SteerQueueScope | undefined => {
  const origin = state.origin;
  if (!origin?.topicId || !origin.threadId || !origin.lineage?.isSubAgent) return;

  return { threadId: origin.threadId, topicId: origin.topicId, userId };
};
