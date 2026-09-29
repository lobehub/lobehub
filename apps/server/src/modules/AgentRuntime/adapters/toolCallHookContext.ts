import type { ToolCallHookContext, ToolRunContext } from '@lobechat/agent-runtime';
import { resolveHookUserId } from '@lobechat/agent-runtime';
import type { ChatToolPayload } from '@lobechat/types';

import type { RuntimeExecutorContext } from '../context';
import { resolveRunActiveDeviceId } from '../executors/resolveRunActiveDeviceId';

/** Shared input for observation, local mock, completion and error notifications. */
export const buildToolCallHookContext = (
  call: ChatToolPayload,
  context: ToolRunContext,
  runtime: Pick<
    RuntimeExecutorContext,
    'operationId' | 'stepIndex' | 'topicId' | 'userId' | 'workspaceId'
  > & { streamManager: Pick<RuntimeExecutorContext['streamManager'], 'sendToolExecute'> },
): ToolCallHookContext => {
  const { origin } = context.state;

  return {
    activeDeviceId: resolveRunActiveDeviceId(context.state),
    agentId: origin?.agentId ?? context.agentId,
    apiName: call.apiName,
    args: context.parsedArgs,
    assistantMessageId: context.parentMessageId,
    callIndex: context.callIndex,
    documentId: origin?.documentId,
    executionTarget: context.state.plan?.execution?.target,
    executor:
      call.executor === 'client' && typeof runtime.streamManager.sendToolExecute === 'function'
        ? 'client'
        : 'server',
    groupId: origin?.groupId ?? context.groupId,
    identifier: call.identifier,
    operationId: runtime.operationId,
    parentOperationId: origin?.lineage?.parentOperationId,
    sessionId: origin?.sessionId,
    sourceMessageId: origin?.sourceMessageId ?? context.messageId,
    stepIndex: runtime.stepIndex,
    taskId: origin?.taskId,
    threadId: origin?.threadId ?? context.threadId,
    toolCallId: call.id,
    toolMessageId: context.toolMessageId,
    toolSource: context.toolSource ?? call.source,
    topicId: origin?.topicId ?? context.topicId ?? runtime.topicId,
    userId: resolveHookUserId(
      runtime.userId ?? origin?.userId,
      context.state.principal?.actor?.shareVisitor,
    ),
    workspaceId: origin?.workspaceId ?? context.workspaceId ?? runtime.workspaceId,
  };
};
