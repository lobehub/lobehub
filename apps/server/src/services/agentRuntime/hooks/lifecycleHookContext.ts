import type { AgentHookEvent, AgentState } from '@lobechat/agent-runtime';

/** Correlation for step and terminal notifications, sourced only from the trusted run state. */
export function buildLifecycleHookContext(
  operationId: string,
  state: Pick<AgentState, 'origin'> | undefined,
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
  const origin = state?.origin;
  return {
    agentId: origin?.agentId ?? '',
    groupId: origin?.groupId,
    lineage: origin?.lineage,
    operationId,
    parentOperationId: origin?.lineage?.parentOperationId,
    threadId: origin?.threadId,
    topicId: origin?.topicId,
    userId,
    workspaceId: origin?.workspaceId,
  };
}
