import type { ConversationContext } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/**
 * Shared backfill of the child's terminal result onto the parent's tool
 * message: content first, then the authoritative plugin state. Used by BOTH
 * the resume path (which continues with re-entry) and the
 * parent-settled-out-of-band path (P2 round-16: a cancelled parent still
 * needs its rendered tool card settled).
 *
 * Routing: the resume path routes through the parent `operationId` (the op is
 * running by the parked guard); the out-of-band path passes the parent
 * `context` explicitly — its op may be cancelled or GC'd, and routing through
 * it would degrade to global-state resolution. `resumePending` is the P1
 * (round-15) durable park signal — only the resume path sets it: on the
 * out-of-band path nobody will ever consume the marker, and a stale one
 * would read as a phantom resume target to reconstruction.
 */
export const backfillChildResult = async (
  get: () => any,
  parentContext: ConversationContext,
  toolMessageId: string,
  options: {
    context?: ConversationContext;
    operationId?: string;
    resultContent: string;
    stats: Record<string, number | string | undefined>;
    succeeded: boolean;
    resumePending?: boolean;
  },
): Promise<void> => {
  // 1. Backfill the placeholder so the parent's conversation (rebuilt from
  //    persisted messages) sees the child's final output.
  await get().optimisticUpdateMessageContent(
    toolMessageId,
    options.resultContent,
    undefined,
    options.context ? { context: options.context } : { operationId: options.operationId },
  );

  // 2. Persist the authoritative completion state on the tool message —
  //    replaces the deferred `{ status: 'running', threadId }` placeholder
  //    state, feeds the Inspector row, and mirrors the normal path's write.
  //    Flat stats ride on the SAME state object (CallSubAgentState contract:
  //    the completion bridge is the authoritative stats writer).
  // P2 (round-7): MERGE over the current plugin state — the deferred state's
  // threadId carries the Open Thread coordinates; a blind replace drops it
  // the moment the child settles.
  // NOTE: the resume path keeps the legacy 2-arg call shape (no routing arg —
  // it resolves through the running op's global state); only the out-of-band
  // path routes explicitly, because its op may be cancelled or GC'd.
  const rows: Array<{ id?: string; pluginState?: Record<string, any> }> =
    get().dbMessagesMap[messageMapKey(parentContext)] || [];
  const toolRow = rows.find((m) => m.id === toolMessageId);
  const pluginState = {
    ...toolRow?.pluginState,
    ...(options.resumePending ? { resumePending: true } : {}),
    status: options.succeeded ? 'completed' : 'error',
    ...options.stats,
  };
  if (options.context) {
    await get().optimisticUpdatePluginState(toolMessageId, pluginState, {
      context: options.context,
    });
  } else {
    await get().optimisticUpdatePluginState(toolMessageId, pluginState);
  }
};
