import { isQueueBlockingOperation } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';

/**
 * The operation in `key` a fresh send must queue behind, if any.
 *
 * `optimisticUserMessageId` is the voice message whose upload transaction is
 * sending: it must not queue behind its own upload (or a later voice upload);
 * earlier voice uploads still block.
 */
export const findRunningBlockingOp = (
  get: () => ChatStore,
  key: string,
  optimisticUserMessageId?: string,
) => {
  const contextOpIds = get().operationsByContext[key] || [];
  const hasQueuedMessages = (get().queuedMessages[key]?.length ?? 0) > 0;
  const ownVoiceUploadIndex = optimisticUserMessageId
    ? contextOpIds.findIndex((id) => {
        const operation = get().operations[id];
        return (
          operation?.type === 'uploadVoiceMessage' &&
          operation.context.messageId === optimisticUserMessageId
        );
      })
    : -1;

  return contextOpIds
    .map((id, index) => ({ index, operation: get().operations[id] }))
    .find(
      ({ index, operation }) =>
        operation &&
        // Shared predicate — an op the composer already treats as finished
        // (aborting, or done with its visible output) must NOT swallow this
        // send into the tray.
        isQueueBlockingOperation(operation, { hasQueuedMessages }) &&
        !(
          optimisticUserMessageId &&
          operation.type === 'uploadVoiceMessage' &&
          (operation.context.messageId === optimisticUserMessageId ||
            (ownVoiceUploadIndex >= 0 && index > ownVoiceUploadIndex))
        ),
    )?.operation;
};
