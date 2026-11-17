import type { ConversationContext, UploadFileItem } from '@lobechat/types';

import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import {
  isSendableQueuedMessage,
  mergeQueuedMessages,
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
} from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { getFollowUpMode } from './followUpMode';

/**
 * The conversation key whose queue nothing will drain, so a new send must
 * take it along instead of overtaking it: behind a Stop, or — on an existing
 * topic — left by a failed run or restored from the server.
 */
export const findOrphanedQueueKey = (
  get: () => ChatStore,
  keys: string[],
  willCreateNewTopic: boolean,
): string | undefined =>
  keys.find((key) => {
    // A steer that may already be with the agent is not sent again on its own.
    if (!(get().queuedMessages[key] ?? []).some(isSendableQueuedMessage)) return false;
    if (!willCreateNewTopic) return true;
    return (get().operationsByContext[key] || []).some((id) => {
      const operation = get().operations[id];
      return operation?.status === 'cancelled' && operation.metadata.isAborting;
    });
  });

/** Queued messages taken to start one turn. */
export interface QueuedTurn {
  messages: QueuedMessage[];
  /** Taken from the head of a queue sent one message per turn; the rest waits behind it. */
  queueHead?: boolean;
}

/**
 * Take what the next turn sends from a queue nothing runs behind any more. In
 * Queue mode that is its head alone, one message per turn; otherwise all of it,
 * merged into one message.
 */
export const drainQueuedTurn = (get: () => ChatStore, contextKey: string): QueuedTurn => {
  if (getFollowUpMode() !== 'queue') return { messages: get().drainQueuedMessages(contextKey) };

  return { messages: get().drainQueuedMessages(contextKey, { limit: 1 }), queueHead: true };
};

/**
 * Send drained queued messages as one turn of their own. The run they waited
 * behind already ended, so this is a fresh turn — not a steer of it — and the
 * user message stays unmarked.
 */
export const sendQueuedMessages = (
  get: () => ChatStore,
  context: ConversationContext,
  messages: QueuedMessage[],
  options?: { queueHead?: boolean },
): Promise<unknown> => {
  const merged = mergeQueuedMessages(messages);
  const mergedFiles =
    merged.filesPreview.length > 0
      ? reconstructUploadFilesFromQueue(merged.filesPreview)
      : merged.files.length > 0
        ? (merged.files.map((id) => ({ id })) as UploadFileItem[])
        : undefined;

  return get().sendMessage({
    context,
    editorData: merged.editorData,
    files: mergedFiles,
    ...(merged.forceRuntime ? { forceRuntime: merged.forceRuntime } : {}),
    message: merged.content,
    metadata: merged.metadata,
    ...(options?.queueHead && { queueHead: true }),
  });
};

/** Send a {@link QueuedTurn}. */
export const sendQueuedTurn = (
  get: () => ChatStore,
  context: ConversationContext,
  turn: QueuedTurn,
): Promise<unknown> =>
  sendQueuedMessages(get, context, turn.messages, { queueHead: turn.queueHead });

/** Shared by streamed completion and recovery from a server terminal snapshot. */
export const scheduleQueuedFollowUp = (
  get: () => ChatStore,
  context: ConversationContext,
  operationId: string,
  onEmpty?: () => void,
): void => {
  const contextKey = messageMapKey(context);
  const execContext = { ...context };

  // Keep the queue visible until the send takes ownership of it. Recheck the
  // owner at that point: a user can start another turn during this hand-off.
  setTimeout(() => {
    if (operationSelectors.hasNewerConversationOperation(operationId, context)(get())) return;
    const turn = drainQueuedTurn(get, contextKey);
    if (turn.messages.length === 0) {
      onEmpty?.();
      return;
    }

    sendQueuedTurn(get, execContext, turn).catch((error: unknown) => {
      console.error('[executeClientAgent] sendMessage for queued content failed:', error);
    });
  }, 100);
};
