import { LOADING_FLAT } from '@lobechat/const';
import { generateEntityId } from '@lobechat/utils';

import { useChatStore } from '@/store/chat';

export interface SendVisitorMessageParams {
  agentId: string;
  message: string;
  shareId: string;
  /** Absent → the run creates a new visitor topic. */
  topicId?: string | null;
}

/**
 * Share-visitor send: the optimistic echo of the owner `sendMessage` path
 * (`conversationLifecycle.ts`), without its owner-only preamble.
 *
 * `sendMessage` itself cannot be reused here — it reads the full owner agent
 * config and runs `ensureAgentManagementAccess`, which a visitor fails. But
 * calling `executeGatewayAgent` bare (the previous behaviour) left the list
 * empty until the first gateway event: no user bubble, no assistant
 * placeholder, and nothing for the loading UI to attach to. This mirrors the
 * pieces that matter for the visitor:
 *
 * 1. Mint the final row ids up front — the share `execAgent` route honours
 *    `clientIds` verbatim, so the optimistic rows never need re-keying.
 * 2. Insert the user bubble and a `LOADING_FLAT` assistant placeholder
 *    immediately, under a `sendMessage` operation so `ContentLoading` shows
 *    the generating state during the phase-1 round-trip.
 * 3. Hand the operation to `executeGatewayAgent` as `parentOperationId`, which
 *    completes it once the child `execServerAgentRuntime` op is running.
 */
export const sendVisitorMessage = async ({
  agentId,
  message,
  shareId,
  topicId,
}: SendVisitorMessageParams) => {
  const store = useChatStore.getState();
  const messageContext = {
    agentId,
    agentShareId: shareId,
    scope: 'main' as const,
    topicId: topicId ?? undefined,
  };
  const userMessageId = generateEntityId('messages');
  const assistantMessageId = generateEntityId('messages');

  const { operationId } = store.startOperation({
    context: { ...messageContext, messageId: userMessageId },
    label: 'Send Message',
    type: 'sendMessage',
  });

  store.optimisticCreateTmpMessage(
    { agentId, content: message, role: 'user', topicId: messageContext.topicId },
    { operationId, tempMessageId: userMessageId },
  );
  store.optimisticCreateTmpMessage(
    { agentId, content: LOADING_FLAT, role: 'assistant', topicId: messageContext.topicId },
    { operationId, tempMessageId: assistantMessageId },
  );
  store.associateMessageWithOperation(userMessageId, operationId);
  store.associateMessageWithOperation(assistantMessageId, operationId);

  const removeOptimisticRows = () => {
    store.internal_dispatchMessage(
      { ids: [userMessageId, assistantMessageId], type: 'deleteMessages' },
      { operationId },
    );
  };

  try {
    const result = await store.executeGatewayAgent({
      clientIds: { assistantMessageId, userMessageId },
      context: messageContext,
      message,
      messageContext,
      parentOperationId: operationId,
      tempMessageIds: [assistantMessageId],
    });
    // A new topic is fetched and switched to by the gateway under its real id;
    // the optimistic rows were written to the pre-topic bucket and would
    // otherwise linger there for the next "new conversation" surface.
    if (!topicId) removeOptimisticRows();
    return result;
  } catch (error) {
    // A Stop during phase-1 already marked the op cancelled — keep that.
    if (useChatStore.getState().operations[operationId]?.status !== 'cancelled') {
      store.failOperation(operationId, {
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'GatewayError',
      });
    }
    removeOptimisticRows();
    throw error;
  }
};
