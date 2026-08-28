import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';

/**
 * Whether a stand-in reply should be shown under a user turn.
 *
 * A retry deletes the failed reply BEFORE its replacement exists (delete-first is
 * deliberate — regenerating first switches the branch away and strands the failed
 * attempt). Measured on the real app, that leaves ~250ms in which the user turn
 * has no reply under it at all, so there is no message left to carry a loading
 * state and the click reads as "nothing happened".
 *
 * True only inside that gap: a retry is running for this turn AND nothing is
 * rendered beneath it yet. Once the replacement arrives it carries its own
 * loading state, and two stacked bubbles would read as two separate replies.
 */
export const usePendingRetryTurn = (userMessageId: string) => {
  const isRetrying = useConversationStore(
    messageStateSelectors.isMessageRegenerating(userMessageId),
  );
  const hasNoReply = useConversationStore(dataSelectors.hasNoRenderedReply(userMessageId));
  const agentId = useConversationStore(
    (s) => dataSelectors.getDisplayMessageById(userMessageId)(s)?.agentId,
  );

  return { agentId, showPendingTurn: isRetrying && hasNoReply };
};
