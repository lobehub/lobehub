import { contextReplayMessageIds } from '@lobechat/context-engine';
import { chainCompressContext } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentByIdSelectors, agentSelectors } from '@/store/agent/selectors';
import { dbMessageSelectors, topicSelectors } from '@/store/chat/selectors';
import { scheduleQueuedFollowUp } from '@/store/chat/slices/agentRun/actions/lifecycle/queuedFollowUp';
import { type ChatStore } from '@/store/chat/store';
import {
  createPendingCompressedGroup,
  getCompressionCandidateMessages,
  withPendingCompressedGroup,
} from '@/store/chat/utils/compression';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

const isAbortError = (error: unknown, abortController?: AbortController) =>
  !!abortController?.signal.aborted ||
  (error instanceof Error &&
    (error.name === 'AbortError' ||
      error.message.includes('aborted') ||
      error.message.includes('cancelled')));

export interface ContextCompressionOptions {
  /** Keep this message and everything after it out of the summary. */
  beforeMessageId?: string;
  /**
   * Retry action offered in the failure toast. Defaults to running the same compaction again;
   * callers that chain work after compaction (e.g. compact-and-retry) pass their full flow.
   */
  onRetry?: () => void;
}

const createAbortError = () =>
  Object.assign(new Error('Compression cancelled'), { name: 'AbortError' });

export interface ContextCompressionParams extends ContextCompressionOptions {
  context: Record<string, any>;
  parentOperationId: string;
}

/**
 * Compress the conversation history into a summary group (`/compact` and the compact-and-retry
 * error card). Reuses the same service methods as the agent runtime's compress_context executor.
 *
 * @returns Whether the history was replaced by a summary. A failed or empty summary rolls the
 * compression group back so the original messages stay intact.
 */
export const executeContextCompression = async (
  params: ContextCompressionParams,
  get: () => ChatStore,
): Promise<boolean> => {
  const { context, parentOperationId, ...options } = params;
  const { agentId, topicId } = context;
  if (!topicId) return false;

  const contextKey = messageMapKey(context as any);
  const dbMessages = dbMessageSelectors.getDbMessagesByKey(contextKey)(get()) || [];
  const visible = getCompressionCandidateMessages(get().messagesMap[contextKey] ?? dbMessages, {
    ...options,
    threadId: context.threadId,
  });
  const visibleIds = new Set(contextReplayMessageIds(visible));
  const selected = dbMessages.filter(
    (message) =>
      (message.role === 'compressedGroup' ||
        (message.threadId ?? null) === (context.threadId ?? null)) &&
      (visibleIds.has(message.id) ||
        (message.role === 'tool' && !!message.parentId && visibleIds.has(message.parentId))),
  );
  const sourceGroups = selected.filter(
    (message) =>
      message.role === 'compressedGroup' &&
      message.threadId !== undefined &&
      (message.threadId ?? null) === (context.threadId ?? null),
  );
  const sourceGroupIds = sourceGroups.map((message) => message.id);
  const messageIds = selected
    .filter((message) => message.role !== 'compressedGroup')
    .map((message) => message.id);
  if (messageIds.length === 0 && sourceGroupIds.length === 0) return false;

  const tempId = 'tmp_compress_' + nanoid();
  const { abortController, operationId } = get().startOperation({
    context: { ...context, messageId: tempId },
    parentOperationId,
    type: 'contextCompression',
  });

  // Immediate UI feedback: render a pending compressed group from the first frame
  get().internal_createClientMessage(
    tempId,
    createPendingCompressedGroup({
      agentId,
      groupId: context.groupId,
      id: tempId,
      // Without `beforeMessageId` every message above is folded, so the group
      // belongs at the end, not above the last question.
      keepPosition: !options.beforeMessageId,
      threadId: context.threadId,
      topicId,
    }) as any,
    { operationId },
  );

  let messageGroupId: string | undefined;

  try {
    // 1. Create compression group on server
    // Scope the group to the open conversation: without `threadId` the server reads the main
    // conversation, so a thread compaction summarized and returned the wrong messages.
    const result = await messageService.createCompressionGroup({
      agentId,
      groupId: context.groupId,
      messageIds,
      sourceGroupIds,
      threadId: context.threadId,
      topicId,
    });
    const { messages: serverMessages, messagesToSummarize } = result;
    messageGroupId = result.messageGroupId;
    const groupId = messageGroupId;

    // Replace local pending group with server compression group
    get().replaceMessages(
      withPendingCompressedGroup(serverMessages, {
        agentId,
        groupId: context.groupId,
        id: messageGroupId,
        keepPosition: !options.beforeMessageId,
        threadId: context.threadId,
        topicId,
      }),
      { context: context as any },
    );
    get().associateMessageWithOperation(messageGroupId, operationId);
    if (abortController.signal.aborted) throw createAbortError();

    // 2. Generate summary via LLM. Match the runtime's auto-compression model resolution: a model
    // pinned to the topic wins over the agent default (see streamingExecutor).
    // The summary goes through the regular chat endpoint, so only an API pin is usable:
    // heterogeneous topics pin the CLI runtime (e.g. `cursor/default`), and a model-only legacy
    // pin has no provider to route to. Both keep the agent default.
    const agentState = getAgentStoreState();
    const topicModel = agentByIdSelectors.isAgentHeterogeneousById(agentId)(agentState)
      ? undefined
      : topicSelectors.getTopicModelById(topicId)(get());
    const { model, provider } = topicModel?.provider
      ? topicModel
      : agentSelectors.getAgentConfigById(agentId)(agentState);
    const compressionPayload = chainCompressContext(messagesToSummarize, result.existingSummary);
    let summaryContent = '';
    let summaryError: Error | undefined;

    // fetchPresetTaskResult reports request failures (e.g. a chat-security 403 or a provider
    // timeout) through onError instead of rejecting, so capture them explicitly.
    await chatService.fetchPresetTaskResult({
      abortController,
      onError: (error) => {
        summaryError = error;
      },
      onMessageHandle: (chunk) => {
        if (chunk.type === 'text') {
          summaryContent += chunk.text || '';
          get().internal_dispatchMessage(
            { id: groupId, type: 'updateMessage', value: { content: summaryContent } },
            { operationId },
          );
        }
      },
      params: { ...compressionPayload, model, provider },
      trigger: RequestTrigger.ContextCompression,
    });

    if (abortController.signal.aborted) throw createAbortError();
    if (summaryError) throw summaryError;
    // Finalizing an empty summary would fold the history into a blank group and lose it.
    if (!summaryContent.trim()) throw new Error(t('compression.emptySummary', { ns: 'chat' }));

    // 3. Finalize compression
    const finalResult = await messageService.finalizeCompression({
      agentId,
      content: summaryContent,
      groupId: context.groupId,
      messageGroupId: groupId,
      sourceGroupIds,
      threadId: context.threadId,
      topicId,
    });

    if (finalResult.messages) {
      get().replaceMessages(finalResult.messages, { context: context as any });
    }

    get().completeOperation(operationId);
    if (!parentOperationId) scheduleQueuedFollowUp(get, context as any, operationId);
    return true;
  } catch (error) {
    const cancelled = isAbortError(error, abortController);
    if (!cancelled) console.error('[/compact] Compression failed:', error);
    get().internal_dispatchMessage({ type: 'deleteMessages', ids: [tempId] }, { operationId });

    // Roll the server group back so the original messages are restored instead of being
    // hidden behind an unfinished summary.
    if (messageGroupId) {
      try {
        const rollback = await messageService.cancelCompression({
          agentId,
          groupId: context.groupId,
          messageGroupId,
          threadId: context.threadId,
          topicId,
        });
        get().replaceMessages(rollback.messages, { context: context as any });
      } catch (rollbackError) {
        console.error('[/compact] Failed to rollback compression:', rollbackError);
      }
    }
    if (cancelled) {
      if (get().operations[operationId]?.status === 'running')
        await get().cancelOperation(operationId, 'compression_cancelled');
      return false;
    }

    const reason = error instanceof Error ? error.message : String(error);
    get().failOperation(operationId, { message: reason, type: 'compression_failed' });
    // Keep the toast until dismissed: the conversation looks unchanged after the rollback, so a
    // toast that fades on its own leaves no trace that compaction was attempted.
    const retry =
      options.onRetry ?? (() => void get().executeCompression(context, parentOperationId, options));
    const failureToast = toast.error({
      actions: [
        {
          label: t('retry', { ns: 'common' }),
          // A failed retry raises its own toast, so close this one instead of stacking them
          onClick: () => {
            failureToast.close();
            retry();
          },
          variant: 'text',
        },
      ],
      description: t('compression.failedReason', { ns: 'chat', reason }),
      duration: 0,
      title: t('compression.failed', { ns: 'chat' }),
    });
    return false;
  }
};
