import { UsageCounter } from '../core';
import type { AgentRuntimeHost } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AnyHookEvent,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
} from '../types';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error);
};

const dispatchLifecycle = (
  host: AgentRuntimeHost,
  type: Parameters<NonNullable<AgentRuntimeHost['lifecycle']>['dispatch']>[0]['type'],
  event: AnyHookEvent,
  serializedHooks: unknown,
) => {
  host.lifecycle
    ?.dispatch({
      event,
      serializedHooks,
      type,
    })
    .catch(() => {});
};

/**
 * `compress_context` executor — creates a compressed message group, asks the
 * configured compression model to summarize it, and returns a
 * `compression_result` phase that the agent can continue from.
 */
export const compressContext =
  (host: AgentRuntimeHost): InstructionExecutor =>
  async (instruction, state) => {
    const { payload } = instruction as Extract<AgentInstruction, { type: 'compress_context' }>;
    const { messages, currentTokenCount, existingSummary } = payload;
    const { operation, transports } = host;
    const { operationId, stepIndex, userId } = operation;
    const events: AgentEvent[] = [];
    const newState = structuredClone(state);
    const topicId = state.metadata?.topicId ?? operation.topicId;
    const workspaceId = state.metadata?.workspaceId ?? operation.workspaceId;
    const agentId = operation.agentId ?? state.metadata?.agentId;
    const groupId = operation.groupId ?? state.metadata?.groupId;
    const threadId = operation.threadId ?? state.metadata?.threadId;
    const compression = transports.compression;
    const llm = transports.llm;
    const lastMessage = messages.at(-1);
    const preservedMessages =
      messages.length > 1 && lastMessage?.role === 'user' ? [lastMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = preservedMessages.length > 0 ? messages.slice(0, -1) : messages;
    const compressedMessagesFallback = [...messagesToCompress, ...preservedMessages];

    const createNextContext = ({
      compressedMessages,
      groupId,
      parentMessageId,
      skipped,
    }: GeneralAgentCompressionResultPayload) => ({
      payload: {
        compressedMessages,
        groupId,
        parentMessageId,
        skipped,
      } as GeneralAgentCompressionResultPayload,
      phase: 'compression_result' as const,
      session: {
        messageCount: newState.messages.length,
        sessionId: operationId,
        status: 'running' as const,
        stepCount: state.stepCount + 1,
      },
    });

    const skippedResult = (parentMessageId?: string) => ({
      events,
      newState,
      nextContext: createNextContext({
        compressedMessages: compressedMessagesFallback,
        groupId: '',
        parentMessageId,
        skipped: true,
      }),
    });

    if (!topicId || !agentId || !compression || !llm) {
      return skippedResult();
    }

    dispatchLifecycle(
      host,
      'beforeCompact',
      {
        messageCount: messagesToCompress.length,
        operationId,
        stepIndex,
        tokenCount: currentTokenCount,
        userId,
      } as AnyHookEvent,
      state.metadata?._hooks,
    );

    let createdGroupId: string | undefined;

    try {
      const dbMessages = await transports.messages.query(
        {
          agentId,
          groupId,
          threadId,
          topicId,
        },
        { resolveAssetUrls: true },
      );

      const sourceCompressionGroups = dbMessages.filter(
        (message) => message.role === 'compressedGroup' && Boolean(message.id),
      );
      const sourceGroupIds = sourceCompressionGroups
        .map((message) => message.id)
        .filter((id): id is string => Boolean(id));
      const persistedExistingSummary = sourceCompressionGroups
        .map((message) => (typeof message.content === 'string' ? message.content.trim() : ''))
        .filter(Boolean)
        .join('\n\n');

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      if (
        (messageIds.length === 0 && sourceGroupIds.length === 0) ||
        messagesToCompress.length === 0
      ) {
        return skippedResult();
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      const parentMessageId =
        latestAssistantMessage?.id ??
        (sourceCompressionGroups.at(-1) as { lastMessageId?: string } | undefined)?.lastMessageId;
      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        return skippedResult(parentMessageId);
      }

      const compressionResult = await compression.createGroup({
        agentId,
        groupId,
        messageIds,
        threadId,
        topicId,
        workspaceId,
      });
      createdGroupId = compressionResult.messageGroupId;

      const compressionPayload = await compression.buildPrompt({
        existingSummary: persistedExistingSummary || existingSummary,
        messages: compressionResult.messagesToSummarize,
      });

      let streamedSummary = '';
      const summaryResult = await llm.stream(
        {
          messages: compressionPayload.messages,
          model: compressionModel.model,
          provider: compressionModel.provider,
          stream: true,
        },
        {
          onText: (text) => {
            streamedSummary += text;
            compression.updateGroup?.({
              content: streamedSummary,
              messageGroupId: compressionResult.messageGroupId,
            });
          },
        },
        compressionResult.signal,
      );

      if (compressionResult.signal?.aborted) {
        const abortError = new Error('Context compression cancelled');
        abortError.name = 'AbortError';
        throw abortError;
      }

      const finalCompression = await compression.finalizeGroup({
        agentId,
        content: summaryResult.content,
        groupId,
        messageGroupId: compressionResult.messageGroupId,
        sourceGroupIds,
        threadId,
        topicId,
        workspaceId,
      });

      const sourceGroupIdSet = new Set(sourceGroupIds);
      const finalizedMessagesFallback = compressionResult.messages
        ?.filter((message) => !sourceGroupIdSet.has(message.id))
        .map((message) =>
          message.id === compressionResult.messageGroupId
            ? { ...message, content: summaryResult.content }
            : message,
        );
      const compressedMessagesBase =
        finalCompression.messages ??
        finalizedMessagesFallback ??
        compressionResult.messagesToSummarize;
      const compressedMessages = [...compressedMessagesBase];

      for (const preservedMessage of preservedMessages) {
        if (
          !compressedMessages.some(
            (message) =>
              message === preservedMessage ||
              (Boolean(message.id) &&
                Boolean(preservedMessage.id) &&
                message.id === preservedMessage.id),
          )
        ) {
          compressedMessages.push(preservedMessage);
        }
      }

      newState.messages = compressedMessages;

      if (summaryResult.usage) {
        const { usage, cost } = UsageCounter.accumulateLLM({
          cost: newState.cost,
          model: compressionModel.model,
          modelUsage: summaryResult.usage,
          provider: compressionModel.provider,
          usage: newState.usage,
        });

        newState.usage = usage;
        if (cost) newState.cost = cost;
      }

      events.push({
        groupId: compressionResult.messageGroupId,
        parentMessageId,
        type: 'compression_complete',
      });

      dispatchLifecycle(
        host,
        'afterCompact',
        {
          groupId: compressionResult.messageGroupId,
          messagesAfter: compressedMessages.length,
          messagesBefore: messagesToCompress.length,
          operationId,
          stepIndex,
          summary: summaryResult.content.slice(0, 500),
          userId,
        } as AnyHookEvent,
        state.metadata?._hooks,
      );

      return {
        events,
        newState,
        nextContext: {
          ...createNextContext({
            compressedMessages,
            groupId: compressionResult.messageGroupId,
            parentMessageId,
          }),
          session: {
            messageCount: compressedMessages.length,
            sessionId: operationId,
            status: 'running' as const,
            stepCount: state.stepCount + 1,
          },
        },
      };
    } catch (error) {
      if (createdGroupId && compression.rollbackGroup) {
        try {
          await compression.rollbackGroup({
            agentId,
            error,
            groupId,
            messageGroupId: createdGroupId,
            threadId,
            topicId,
            workspaceId,
          });
        } catch (rollbackError) {
          console.error('Failed to rollback context compression', rollbackError);
        }
      }

      dispatchLifecycle(
        host,
        'onCompactError',
        {
          error: getErrorMessage(error),
          operationId,
          stepIndex,
          tokenCount: currentTokenCount,
          userId,
        } as AnyHookEvent,
        state.metadata?._hooks,
      );

      events.push({ error, type: 'compression_error' });

      return skippedResult();
    }
  };
