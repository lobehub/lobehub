import { chainCompressContext } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { toast } from '@lobehub/ui';
import { t } from 'i18next';

import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import {
  createPendingCompressedGroup,
  getCompressionCandidateMessageIds,
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
  const messageIds = getCompressionCandidateMessageIds(dbMessages, options);
  if (messageIds.length === 0) return false;

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
      threadId: context.threadId,
      topicId,
    }) as any,
    { operationId },
  );

  let messageGroupId: string | undefined;

  try {
    // 1. Create compression group on server
    const result = await messageService.createCompressionGroup({
      agentId,
      messageIds,
      topicId,
    });
    const { messages: serverMessages, messagesToSummarize } = result;
    messageGroupId = result.messageGroupId;
    const groupId = messageGroupId;

    // Replace local pending group with server compression group
    get().replaceMessages(serverMessages, { context: context as any });
    get().associateMessageWithOperation(messageGroupId, operationId);

    // 2. Generate summary via LLM
    const { model, provider } = agentSelectors.getAgentConfigById(agentId)(getAgentStoreState());
    const compressionPayload = chainCompressContext(messagesToSummarize);
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
      messageGroupId: groupId,
      topicId,
    });

    if (finalResult.messages) {
      get().replaceMessages(finalResult.messages, { context: context as any });
    }

    get().completeOperation(operationId);
    return true;
  } catch (error) {
    if (isAbortError(error, abortController)) {
      get().internal_dispatchMessage({ type: 'deleteMessages', ids: [tempId] }, { operationId });
      return false;
    }

    console.error('[/compact] Compression failed:', error);
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
