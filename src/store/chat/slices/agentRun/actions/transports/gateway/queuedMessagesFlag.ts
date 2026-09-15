import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';
import type { ChatStore } from '@/store/chat/store';

interface FlagWrite {
  desired: boolean;
  sent?: boolean;
}

/** In-flight flag writes, keyed by server operation id. */
const flagWrites = new Map<string, FlagWrite>();

/**
 * Write one operation's flag in order. Queue then delete fires two writes; sent
 * concurrently, a delayed `true` could land after the `false` and end the run
 * with an empty queue. While a request is in flight only the latest wanted
 * value is kept, and it is sent once that request settles.
 */
const writeFlag = (
  serverOperationId: string,
  pending: boolean,
  send: (pending: boolean) => Promise<unknown>,
) => {
  const inFlight = flagWrites.get(serverOperationId);
  if (inFlight) {
    inFlight.desired = pending;
    return;
  }

  const write: FlagWrite = { desired: pending };
  flagWrites.set(serverOperationId, write);

  const drain = async () => {
    while (write.sent !== write.desired) {
      const value = write.desired;
      try {
        await send(value);
        write.sent = value;
      } catch (error) {
        console.error('[Gateway] setQueuedMessages failed:', error);
        // Retry only for a newer value; repeating the failed one would loop.
        if (write.desired === value) break;
      }
    }
    flagWrites.delete(serverOperationId);
  };

  void drain();
};

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

    writeFlag(serverOperationId, pending, (value) =>
      agentShareId
        ? shareChatService.setQueuedMessages(agentShareId, topicId!, serverOperationId, value)
        : aiAgentService.setQueuedMessages({ operationId: serverOperationId, pending: value }),
    );
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
