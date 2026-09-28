import type { ChatToolPayload } from '@lobechat/types';
import { isPlainRecord } from '@lobechat/utils/object';
import { safeParseJSON } from '@lobechat/utils/safeParseJSON';

import type { RuntimeOperationContext } from '../transport/operation';
import type {
  AfterHumanInterventionHookEvent,
  AgentState,
  BeforeHumanInterventionHookEvent,
  HumanInterventionHookContext,
  StopByHumanInterventionHookEvent,
} from '../types';

/** Callers supply the actual operation; continuation source ids are not parent ids. */
export const buildHumanInterventionHookContext = (
  state: Pick<AgentState, 'origin'>,
  operation: Pick<RuntimeOperationContext, 'operationId' | 'userId'>,
): HumanInterventionHookContext => {
  const { origin } = state;
  return {
    agentId: origin?.agentId,
    documentId: origin?.documentId,
    groupId: origin?.groupId,
    operationId: operation.operationId,
    parentOperationId: origin?.lineage?.parentOperationId,
    sessionId: origin?.sessionId,
    sourceMessageId: origin?.sourceMessageId,
    taskId: origin?.taskId,
    threadId: origin?.threadId,
    topicId: origin?.topicId,
    userId: operation.userId ?? origin?.userId,
    workspaceId: origin?.workspaceId,
  };
};

/** Pass the final pending payloads also sent to storage and the approval UI. */
export const buildBeforeHumanInterventionEvent = (
  context: HumanInterventionHookContext & { stepIndex: number },
  pendingTools: readonly ChatToolPayload[],
): BeforeHumanInterventionHookEvent => ({
  ...context,
  pendingTools: pendingTools.map((tool) => {
    const args = safeParseJSON<unknown>(tool.arguments);
    return {
      apiName: tool.apiName,
      args: isPlainRecord(args) ? args : undefined,
      arguments: tool.arguments,
      identifier: tool.identifier,
      toolCallId: tool.id,
    };
  }),
});

/** One action per event; mixed batch decisions can call this once per action/reason. */
export const buildAfterHumanInterventionEvent = (
  context: HumanInterventionHookContext,
  decision: Pick<AfterHumanInterventionHookEvent, 'action' | 'rejectionReason' | 'toolCallId'> & {
    toolCallIds: readonly string[];
  },
): AfterHumanInterventionHookEvent => ({
  ...context,
  ...decision,
  toolCallId:
    decision.toolCallId ??
    (decision.toolCallIds.length === 1 ? decision.toolCallIds[0] : undefined),
  toolCallIds: [...decision.toolCallIds],
});

export const buildStopByHumanInterventionEvent = (
  context: HumanInterventionHookContext,
  stop: Pick<StopByHumanInterventionHookEvent, 'rejectionReason' | 'toolCallId'> & {
    reason: string;
    toolCallIds: readonly string[];
  },
): StopByHumanInterventionHookEvent => ({
  ...context,
  ...stop,
  toolCallId: stop.toolCallId ?? (stop.toolCallIds.length === 1 ? stop.toolCallIds[0] : undefined),
  toolCallIds: [...stop.toolCallIds],
});
