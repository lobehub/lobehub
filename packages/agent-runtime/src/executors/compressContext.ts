import { UsageCounter } from '../core';
import type { AgentRuntimeHost } from '../transport';
import type {
  AgentEvent,
  AgentInstruction,
  AnyHookEvent,
  GeneralAgentCompressionResultPayload,
  InstructionExecutor,
} from '../types';
import { collectPreservedMessageIds, selectPreservedTail } from '../utils/preserveTail';

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
    const { messages, currentTokenCount, existingSummary, preserveTailTokens } = payload;
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
    // Preservation is the UNION of two independent rules:
    //
    // 1. The latest user turn is the active contract even after assistant/tool
    //    steps have followed it — keeping it verbatim stops compression from
    //    demoting a Task's Current Work instruction into historical prose or
    //    reactivating an older objective. It is found by scanning backwards, so
    //    it may sit BEFORE the trailing slice.
    // 2. The trailing slice within `preserveTailTokens` — without it a
    //    mid-loop compaction drops the tool results and edits the model is
    //    actively working from, and it goes back to re-reading the same files.
    //
    // Neither subsumes the other, and the union is not necessarily a contiguous
    // suffix, so membership (not slicing) decides what gets compressed.
    const preservedTail = selectPreservedTail(messages, preserveTailTokens ?? 0);
    const latestUserMessage =
      messages.length > 1 ? messages.findLast((message) => message.role === 'user') : undefined;

    const preservedSet = new Set(preservedTail);
    if (latestUserMessage) preservedSet.add(latestUserMessage);

    // Filter the source array so both lists keep their original order.
    const preservedMessages = messages.filter((message) => preservedSet.has(message));
    const messagesToCompress = messages.filter((message) => !preservedSet.has(message));
    // Expands folded containers: on the server path a preserved tool round is
    // one virtual `assistantGroup`, and its child rows must be protected from
    // the raw-row filter below by their own ids, not the wrapper's.
    const preservedMessageIds = collectPreservedMessageIds(preservedMessages);
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

      // Persisted rows already represented in the compressed list. Compared on
      // expanded ids because a container's synthetic wrapper id (`tasks-*`,
      // `agentCouncil-*`, `compare-*`) matches no row: a top-level id check
      // would re-append the wrapper on top of the raw children the DB just
      // returned, and the next LLM call would see that task / council output
      // twice. An `assistantGroup` dedupes either way — its id is its first
      // assistant's — so this keeps every container on the same rule.
      const presentRowIds = collectPreservedMessageIds(compressedMessages);

      for (const preservedMessage of preservedMessages) {
        const rowIds = collectPreservedMessageIds([preservedMessage]);
        const alreadyPresent =
          compressedMessages.includes(preservedMessage) ||
          [...rowIds].some((id) => presentRowIds.has(id));

        if (!alreadyPresent) {
          compressedMessages.push(preservedMessage);
          for (const id of rowIds) presentRowIds.add(id);
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
