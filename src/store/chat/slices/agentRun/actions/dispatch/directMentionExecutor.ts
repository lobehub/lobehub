import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ChatMessageError,
  type ConversationContext,
} from '@lobechat/types';

import { aiAgentService } from '@/services/aiAgent';
import { ClientSubAgentTransport } from '@/store/chat/agents/transports/ClientSubAgentTransport';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { aggregateSubagentMetrics } from '@/utils/subagentMetrics';

import type { AgentRuntimeType } from './agentDispatcher';

interface DirectMentionExecutionParams {
  context: ConversationContext;
  instruction: string;
  parentOperationId: string;
  runtimeType: Extract<AgentRuntimeType, 'client' | 'gateway'>;
  sourceMessageId: string;
  targetAgentId: string;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toDirectMentionMessageError = (error: unknown): ChatMessageError => {
  const message = getErrorMessage(error);
  const isDeviceOffline = message.includes('DEVICE_OFFLINE');

  if (isDeviceOffline) {
    return { type: ChatErrorType.DeviceGatewayNotConfigured };
  }

  return {
    body: { message },
    message,
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
};

/**
 * Executes a direct @Agent route as an isolated task and projects its final
 * answer onto the source assistant message in the parent conversation.
 *
 * The server owns durable Thread completion and projection. The client mirrors
 * the result into the active store so the visible conversation updates without
 * waiting for a refetch.
 */
export const executeDirectMention = async (
  params: DirectMentionExecutionParams,
  get: () => ChatStore,
): Promise<void> => {
  const { context, instruction, parentOperationId, runtimeType, sourceMessageId, targetAgentId } =
    params;

  if (!context.topicId) throw new Error('Direct mention requires a persisted topic');

  const { operationId } = get().startOperation({
    context: { ...context, messageId: sourceMessageId },
    parentOperationId,
    type: 'execClientSubAgent',
  });
  get().associateMessageWithOperation(sourceMessageId, operationId);

  let clientThreadId: string | undefined;

  try {
    let resultContent = '';

    if (runtimeType === 'gateway') {
      const result = await new ClientSubAgentTransport(get, operationId).execSubAgent({
        agentId: targetAgentId,
        instruction,
        parentMessageId: sourceMessageId,
        parentOperationId: operationId,
        title: instruction.slice(0, 50),
        topicId: context.topicId,
      });

      if (!result.success) throw new Error(result.error || 'Mentioned agent execution failed');
      resultContent = result.result || '';
    } else {
      const task = await aiAgentService.createClientTaskThread({
        agentId: targetAgentId,
        instruction,
        parentMessageId: sourceMessageId,
        title: instruction.slice(0, 50),
        topicId: context.topicId,
      });
      clientThreadId = task.threadId;

      const threadContext: ConversationContext = {
        ...context,
        agentId: targetAgentId,
        scope: 'sub_agent',
        subAgentId: targetAgentId,
        threadId: task.threadId,
      };
      get().replaceMessages(task.threadMessages, { context: threadContext });
      void get().refreshThreads();

      const runtimeResult = await get().executeClientAgent({
        context: threadContext,
        inPortalThread: true,
        isSubAgent: true,
        messages: task.threadMessages,
        parentMessageId: task.userMessageId,
        parentMessageType: 'user',
        parentOperationId: operationId,
      });
      const threadMessages = get().dbMessagesMap[messageMapKey(threadContext)] || [];
      const metrics = aggregateSubagentMetrics(threadMessages);
      resultContent =
        threadMessages.findLast((message) => message.role === 'assistant')?.content || '';

      await aiAgentService.updateClientTaskThreadStatus({
        completionReason: 'done',
        metadata: {
          totalCost: runtimeResult?.cost?.total,
          totalMessages: threadMessages.length,
          totalTokens: metrics.totalTokens,
          totalToolCalls: metrics.toolCalls,
        },
        resultContent,
        threadId: task.threadId,
      });
    }

    await get().optimisticUpdateMessageContent(sourceMessageId, resultContent, undefined, {
      operationId,
    });
    void get().refreshThreads();
    get().completeOperation(operationId);
  } catch (error) {
    if (clientThreadId) {
      await aiAgentService
        .updateClientTaskThreadStatus({
          completionReason: 'error',
          error: getErrorMessage(error),
          threadId: clientThreadId,
        })
        .catch(console.error);
      void get().refreshThreads();
    }

    await get()
      .optimisticUpdateMessageError(sourceMessageId, toDirectMentionMessageError(error), {
        operationId,
      })
      .catch(console.error);

    get().failOperation(operationId, {
      message: getErrorMessage(error),
      type: 'DirectMentionExecutionError',
    });
    throw error;
  }
};
