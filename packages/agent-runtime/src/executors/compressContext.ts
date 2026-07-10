import { UsageCounter } from '../core';
import type { AgentRuntimeHost } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AnyHookEvent,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
} from '../types';

const requireCompressionTransport = (host: AgentRuntimeHost) => {
  const compression = host.transports.compression;
  if (!compression) {
    throw new Error('CompressionTransport is required for compress_context executor');
  }
  return compression;
};

const requireLLMTransport = (host: AgentRuntimeHost) => {
  const llm = host.transports.llm;
  if (!llm) {
    throw new Error('LLMTransport is required for compress_context executor');
  }
  return llm;
};

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

    if (!topicId || !userId) {
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

    try {
      const compression = requireCompressionTransport(host);
      const llm = requireLLMTransport(host);

      const dbMessages = await transports.messages.query(
        {
          agentId: state.metadata?.agentId,
          groupId: state.metadata?.groupId,
          threadId: state.metadata?.threadId,
          topicId,
        },
        { resolveAssetUrls: true },
      );

      const messageIds = dbMessages
        .filter(
          (message) =>
            message.role !== 'compressedGroup' &&
            Boolean(message.id) &&
            !preservedMessageIds.has(message.id),
        )
        .map((message) => message.id);

      if (messageIds.length === 0 || messagesToCompress.length === 0) {
        return skippedResult();
      }

      const latestAssistantMessage = dbMessages.findLast((message) => message.role === 'assistant');
      const compressionResult = await compression.createGroup({
        agentId: state.metadata?.agentId,
        groupId: state.metadata?.groupId,
        messageIds,
        threadId: state.metadata?.threadId,
        topicId,
        workspaceId,
      });

      const compressionModel =
        newState.modelRuntimeConfig?.compressionModel || newState.modelRuntimeConfig;

      if (!compressionModel?.model || !compressionModel?.provider) {
        return skippedResult(latestAssistantMessage?.id);
      }

      const compressionPayload = await compression.buildPrompt({
        existingSummary,
        messages: compressionResult.messagesToSummarize,
      });

      const summaryResult = await llm.stream({
        messages: compressionPayload.messages,
        model: compressionModel.model,
        provider: compressionModel.provider,
        stream: true,
      });

      const finalCompression = await compression.finalizeGroup({
        agentId: state.metadata?.agentId,
        content: summaryResult.content,
        groupId: state.metadata?.groupId,
        messageGroupId: compressionResult.messageGroupId,
        threadId: state.metadata?.threadId,
        topicId,
        workspaceId,
      });

      const compressedMessagesBase =
        finalCompression.messages || compressionResult.messagesToSummarize;
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
        parentMessageId: latestAssistantMessage?.id,
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
            parentMessageId: latestAssistantMessage?.id,
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
