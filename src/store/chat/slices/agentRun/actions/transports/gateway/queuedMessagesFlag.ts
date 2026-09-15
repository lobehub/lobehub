import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';
import type { ChatStore } from '@/store/chat/store';

/**
 * Mirror whether a conversation still has messages queued behind its running
 * Gateway run, so the server-side run hands its turn back at the next step
 * boundary instead of finishing every remaining step before the follow-up
 * starts.
 *
 * Only top-level Gateway runs are flagged. A client-side run reads the queue
 * straight from the store, and a group member run belongs to its supervisor,
 * which owns the queue. Best-effort: a failed request only means the follow-up
 * waits for the run to end, which is how it behaved before the flag existed.
 */
export const syncQueuedMessagesFlag = (get: () => ChatStore, contextKey: string): void => {
  const state = get();
  const pending = (state.queuedMessages?.[contextKey]?.length ?? 0) > 0;

  for (const id of state.operationsByContext?.[contextKey] ?? []) {
    const operation = state.operations?.[id];
    const serverOperationId = operation?.metadata.serverOperationId;
    if (
      !operation ||
      !serverOperationId ||
      operation.type !== 'execServerAgentRuntime' ||
      operation.status !== 'running'
    )
      continue;

    const parent = operation.parentOperationId
      ? state.operations[operation.parentOperationId]
      : undefined;
    if (parent?.type === 'execServerAgentRuntime') continue;

    const { agentShareId, topicId } = operation.context;
    // Share visitors have no access to the owner-scoped endpoint.
    if (agentShareId && !topicId) continue;

    const request = agentShareId
      ? shareChatService.setQueuedMessages(agentShareId, topicId!, serverOperationId, pending)
      : aiAgentService.setQueuedMessages({ operationId: serverOperationId, pending });

    request.catch((error: unknown) => {
      console.error('[Gateway] setQueuedMessages failed:', error);
    });
  }
};

/**
 * Flag a Gateway run that has just started, but only when messages were already
 * queued while it was being created. A run starts unflagged, so an empty queue
 * needs no request.
 */
export const flagQueuedMessagesOnRunStart = (get: () => ChatStore, contextKey: string): void => {
  if (!get().queuedMessages?.[contextKey]?.length) return;

  syncQueuedMessagesFlag(get, contextKey);
};
