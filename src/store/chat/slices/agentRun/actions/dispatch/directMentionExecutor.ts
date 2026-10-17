import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ChatMessageError,
  type ConversationContext,
} from '@lobechat/types';

import { ClientSubAgentTransport } from '@/store/chat/agents/transports/ClientSubAgentTransport';
import type { ChatStore } from '@/store/chat/store';

interface DirectMentionExecutionParams {
  context: ConversationContext;
  instruction: string;
  parentOperationId: string;
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
  const { context, instruction, parentOperationId, sourceMessageId, targetAgentId } = params;

  if (!context.topicId) throw new Error('Direct mention requires a persisted topic');

  const { operationId } = get().startOperation({
    context: { ...context, messageId: sourceMessageId },
    parentOperationId,
    type: 'execClientSubAgent',
  });
  get().associateMessageWithOperation(sourceMessageId, operationId);

  try {
    const result = await new ClientSubAgentTransport(get, operationId).execSubAgent({
      agentId: targetAgentId,
      instruction,
      parentMessageId: sourceMessageId,
      parentOperationId: operationId,
      title: instruction.slice(0, 50),
      topicId: context.topicId,
    });

    if (!result.success) throw new Error(result.error || 'Mentioned agent execution failed');
    const resultContent = result.result || '';

    await get().optimisticUpdateMessageContent(sourceMessageId, resultContent, undefined, {
      operationId,
    });
    void get().refreshThreads();
    get().completeOperation(operationId);
  } catch (error) {
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
