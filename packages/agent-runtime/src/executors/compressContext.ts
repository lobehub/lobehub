import { UsageCounter } from '../core';
import type { AgentRuntimeHost } from '../transport';
import type {
  AfterCompactHookEvent,
  AgentEvent,
  AgentInstruction,
  BeforeCompactHookEvent,
  CompactErrorHookEvent,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
} from '../types';
import { buildCompactHookContext } from './compactHookContext';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(error);
};

const dispatchLifecycle = async (
  host: AgentRuntimeHost,
  type: 'beforeCompact' | 'afterCompact' | 'onCompactError',
  event: BeforeCompactHookEvent | AfterCompactHookEvent | CompactErrorHookEvent,
  serializedHooks: unknown,
) => {
  try {
    await host.lifecycle?.dispatch({
      event,
      serializedHooks,
      type,
    });
  } catch {
    // A notification failure must never enter the compression rollback/error path.
    // Do not log delivery errors which could include webhook credentials.
    console.error('Failed to deliver context compression notification', { type });
  }
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
    const topicId = state.origin?.topicId ?? operation.topicId;
    const workspaceId = state.origin?.workspaceId ?? operation.workspaceId;
    const agentId = operation.agentId ?? state.origin?.agentId;
    const groupId = operation.groupId ?? state.origin?.groupId;
    const threadId = operation.threadId ?? state.origin?.threadId;
    const compression = transports.compression;
    const llm = transports.llm;
    // The latest user turn is the active contract even after assistant/tool steps have followed it.
    // Keep it verbatim and re-inject it after the summary so compression can never demote a Task's
    // Current Work instruction into historical prose or reactivate an older objective.
    const latestUserMessage =
      messages.length > 1 ? messages.findLast((message) => message.role === 'user') : undefined;
    const preservedMessages = latestUserMessage ? [latestUserMessage] : [];
    const preservedMessageIds = new Set(
      preservedMessages.map((message) => message.id).filter((id): id is string => Boolean(id)),
    );
    const messagesToCompress = latestUserMessage
      ? messages.filter((message) => message !== latestUserMessage)
      : messages;
    const createNextContext = ({
      groupId,
      parentMessageId,
      skipped,
    }: GeneralAgentCompressionResultPayload) => ({
      payload: {
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
        groupId: '',
        parentMessageId,
        skipped: true,
      }),
    });

    if (!topicId || !agentId || !compression || !llm) {
      return skippedResult();
    }

    await dispatchLifecycle(
      host,
      'beforeCompact',
      {
        ...buildCompactHookContext(operation, state.origin),
        messageCount: messagesToCompress.length,
        operationId,
        stepIndex,
        tokenCount: currentTokenCount,
        userId,
      },
      state.host?.hooks,
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

      await dispatchLifecycle(
        host,
        'afterCompact',
        {
          ...buildCompactHookContext(operation, state.origin),
          groupId: compressionResult.messageGroupId,
          messagesAfter: compressedMessages.length,
          messagesBefore: messagesToCompress.length,
          operationId,
          stepIndex,
          summary: summaryResult.content.slice(0, 500),
          userId,
        },
        state.host?.hooks,
      );

      return {
        events,
        newState,
        nextContext: {
          ...createNextContext({
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

      await dispatchLifecycle(
        host,
        'onCompactError',
        {
          ...buildCompactHookContext(operation, state.origin),
          error: getErrorMessage(error),
          operationId,
          stepIndex,
          tokenCount: currentTokenCount,
          userId,
        },
        state.host?.hooks,
      );

      events.push({ error, type: 'compression_error' });

      return skippedResult();
    }
  };
