import { LOADING_FLAT } from '@lobechat/const';
import { ChatErrorType, type ConversationContext, type UIChatMessage } from '@lobechat/types';

import { messageService } from '@/services/message';
import { hydrateProjectedConversation } from '@/services/message/hydrateProjectedTools';
import { buildRunLifecycle } from '@/store/chat/slices/agentRun/actions/lifecycle/buildRunLifecycle';
import type { RunScope } from '@/store/chat/slices/agentRun/actions/lifecycle/types';
import type { ChatStore } from '@/store/chat/store';
import { getToolStoreState } from '@/store/tool';

interface HydrateClientRunParams {
  context: ConversationContext;
  disableTools?: boolean;
  get: () => ChatStore;
  messageKey: string;
  operationId: string;
  originalMessages: UIChatMessage[];
  parentMessageId: string;
  parentMessageType: 'user' | 'assistant' | 'tool';
  scope?: string;
  uninstalledBuiltinTools?: string[];
}

const resolvePendingAssistantId = (
  parentMessageId: string,
  parentMessageType: 'user' | 'assistant' | 'tool',
  dbMessages: UIChatMessage[] | undefined,
  originalMessages: UIChatMessage[],
): string | undefined => {
  if (parentMessageType === 'assistant') return parentMessageId;

  const pool = dbMessages?.length ? dbMessages : originalMessages;
  const directChild = pool.findLast(
    (m) => m.role === 'assistant' && m.parentId === parentMessageId && m.content === LOADING_FLAT,
  );
  if (directChild) return directChild.id;

  const tailLoading = pool.at(-1);
  if (tailLoading?.role === 'assistant' && tailLoading.content === LOADING_FLAT) {
    return tailLoading.id;
  }

  return undefined;
};

/**
 * Hydrate projected tool payloads and omitted reasoning blocks before the first
 * client-runtime step. If restoration fails, surface a visible retryable error
 * on the pending assistant message, fail the operation, and run
 * `completeRun(error)` so the topic status and send queue are never left stuck
 * in `running`.
 */
export const hydrateClientRunContext = async ({
  context,
  disableTools,
  get,
  messageKey,
  operationId,
  originalMessages,
  parentMessageId,
  parentMessageType,
  scope,
  uninstalledBuiltinTools,
}: HydrateClientRunParams): Promise<{
  messages: UIChatMessage[];
  uninstalledBuiltinTools: string[] | undefined;
}> => {
  try {
    const [messages, resolvedTools] = await Promise.all([
      hydrateProjectedConversation(
        [...originalMessages],
        get().dbMessagesMap[messageKey],
        messageService.getToolResultPayloads,
        messageService.getReasonings,
      ),
      uninstalledBuiltinTools ??
        (disableTools ? undefined : getToolStoreState().getUninstalledBuiltinToolsForRun()),
    ]);

    return { messages, uninstalledBuiltinTools: resolvedTools };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to hydrate conversation context';

    const messageError = {
      body: { message: errorMessage },
      message: errorMessage,
      type: ChatErrorType.InternalServerError,
    };

    const pendingAssistantId = resolvePendingAssistantId(
      parentMessageId,
      parentMessageType,
      get().dbMessagesMap[messageKey],
      originalMessages,
    );
    // Surface the error optimistically without blocking operation finalization /
    // queue release on slow error-persistence network calls.
    if (pendingAssistantId) {
      void get()
        .optimisticUpdateMessageError(pendingAssistantId, messageError, { operationId })
        .catch(() => undefined);
    } else if (parentMessageType === 'user') {
      // Retry deletes the prior failed assistant reply before regenerating from
      // the user message; create a fresh error-bearing assistant card so the
      // user keeps a visible error and Retry button on repeated failures.
      void get()
        .optimisticCreateMessage(
          {
            agentId: context.agentId,
            content: '',
            error: messageError,
            groupId: context.groupId ?? undefined,
            parentId: parentMessageId,
            role: 'assistant',
            threadId: context.threadId ?? undefined,
            topicId: context.topicId ?? undefined,
          },
          { operationId },
        )
        .catch(() => undefined);
    }

    get().failOperation(operationId, {
      message: errorMessage,
      type: 'ConversationHydrationError',
    });
    const runScope: RunScope = scope === 'sub_agent' ? 'sub_agent' : 'top_level';
    const runLifecycle = buildRunLifecycle(get, {
      context,
      parentMessageId,
      parentMessageType,
      runId: operationId,
      runScope,
      runtimeType: 'client',
    });
    await runLifecycle.completeRun({
      context,
      operationId,
      runId: operationId,
      runScope,
      runtimeStatus: 'error',
      runtimeType: 'client',
    });
    throw error;
  }
};
