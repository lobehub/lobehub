import { dataSelectors, useConversationStore } from '@/features/Conversation/store';

/**
 * The stored row behind an error card. Inside an assistant group the card's `id` is a
 * child block, which is not a top-level display message; its persisted row still
 * carries the error, model and provider.
 */
export const useFailedMessage = (id: string) =>
  useConversationStore(
    (s) => dataSelectors.getDbMessageById(id)(s) ?? dataSelectors.getDisplayMessageById(id)(s),
  );
