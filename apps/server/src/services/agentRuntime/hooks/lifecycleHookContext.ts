import type { AgentHookEvent, AgentRunOrigin } from '@lobechat/agent-runtime';

/** Correlation for step and terminal notifications, sourced only from the run's origin. */
export function buildLifecycleHookContext(
  operationId: string,
  origin: AgentRunOrigin | undefined,
  userId: string,
): Pick<
  AgentHookEvent,
  | 'agentId'
  | 'groupId'
  | 'lineage'
  | 'operationId'
  | 'parentOperationId'
  | 'threadId'
  | 'topicId'
  | 'userId'
  | 'workspaceId'
> {
  return {
    agentId: origin?.agentId ?? '',
    groupId: origin?.groupId,
    lineage: origin?.lineage,
    operationId,
    parentOperationId: origin?.lineage?.parentOperationId,
    threadId: origin?.threadId,
    topicId: origin?.topicId,
    userId: origin?.userId || userId,
    workspaceId: origin?.workspaceId,
  };
}
