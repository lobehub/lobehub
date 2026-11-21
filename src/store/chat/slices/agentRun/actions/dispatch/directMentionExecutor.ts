import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ChatMessageError,
  type ConversationContext,
  ThreadStatus,
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

const MENTION_MARKUP = /<mention\s[^>]*?name="([^"]*)"[^>]*\/>\s*/g;

/** Thread title for a direct @Agent run: mentions read as `@name`, not as their markup. */
export const toDirectMentionThreadTitle = (instruction: string): string =>
  instruction
    .replaceAll(MENTION_MARKUP, (_, name: string) => `@${name} `)
    .trim()
    .slice(0, 50);

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
  let stopWatching: (() => void) | undefined;
  const endWatching = () => {
    stopWatching?.();
    stopWatching = undefined;
  };

  // The progress card needs the thread now, not after the first poll.
  const showRunningThread = (threadId: string) =>
    get().internal_dispatchMessage(
      {
        id: sourceMessageId,
        type: 'updateMessage',
        value: {
          taskDetail: {
            startedAt: new Date().toISOString(),
            status: ThreadStatus.Processing,
            threadId,
          },
        },
      },
      { operationId },
    );

  try {
    let resultContent = '';

    if (runtimeType === 'gateway') {
      const topicId = context.topicId;
      const transport = new ClientSubAgentTransport(get, operationId, {
        onDispatched: (dispatch) => {
          showRunningThread(dispatch.threadId);
          // The full-record panel resolves the thread's agent from this list.
          void get().refreshThreads();
          // Follow the child live, so its thread fills in as it streams.
          if (!dispatch.token) return;
          stopWatching = get().watchSubAgentRun({
            assistantMessageId: dispatch.assistantMessageId,
            context: {
              agentId: targetAgentId,
              scope: 'thread',
              threadId: dispatch.threadId,
              topicId,
            },
            operationId: dispatch.operationId,
            token: dispatch.token,
          });
        },
      });
      const result = await transport.execSubAgent({
        agentId: targetAgentId,
        instruction,
        parentMessageId: sourceMessageId,
        parentOperationId: operationId,
        title: toDirectMentionThreadTitle(instruction),
        topicId,
      });
      endWatching();

      if (!result.success) throw new Error(result.error || 'Mentioned agent execution failed');
      resultContent = result.result || '';
    } else {
      const task = await aiAgentService.createClientTaskThread({
        agentId: targetAgentId,
        instruction,
        parentMessageId: sourceMessageId,
        title: toDirectMentionThreadTitle(instruction),
        topicId: context.topicId,
      });
      clientThreadId = task.threadId;
      showRunningThread(task.threadId);

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
          // `totalSteps` is the user-facing step metric: actual LLM calls.
          // `totalLlmCalls` is the versioned continuation baseline.
          totalLlmCalls: runtimeResult?.usage?.llm?.apiCalls,
          totalSteps: runtimeResult?.usage?.llm?.apiCalls,
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
    // The thread panel keys its transcript by the mentioned agent; one fetched
    // while the run was still going would otherwise keep an empty reply.
    void get().refreshMessages({ agentId: targetAgentId, topicId: context.topicId });
    get().completeOperation(operationId);
  } catch (error) {
    endWatching();
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
    void get().refreshMessages({ agentId: targetAgentId, topicId: context.topicId });

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
