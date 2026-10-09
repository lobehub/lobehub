import { messageStateSelectors, useConversationStore } from '../store';
import { type ConversationChatInputUiState, getConversationChatInputUiState } from './utils';

export interface UseConversationChatInputUiStateParams {
  /**
   * When true, the placeholder never flips to the followUp variant — used by
   * surfaces (e.g. onboarding) that have no follow-up / pending-message design.
   */
  disableFollowUpVariant?: boolean;
  /** Sending is blocked while loading, so no Send button appears beside Stop. */
  disableQueue?: boolean;
  isInputEmpty: boolean;
}

/**
 * Resolve a conversation composer's send area from its run's op state.
 *
 * Use when:
 * - A composer renders send / stop affordances inside a conversation. Every host
 *   (main chat, task run drawer, acceptance rail) has to react the same way to a
 *   run that is in flight: Stop, plus Send beside it for the queued follow-up —
 *   never a bare Send that reads as "the run has finished".
 *
 * Expects:
 * - Rendered under the conversation's `ConversationProvider`, whose
 *   `operationState` carries the visible-loading flag for that context. A
 *   composer that only tracks its own submit flag will miss a run started
 *   elsewhere (another tab, a scheduled run, the task's own `runTask`).
 *
 * Returns:
 * - `getConversationChatInputUiState`'s shape, with the op state resolved from
 *   the store so hosts cannot disagree about it.
 */
export const useConversationChatInputUiState = ({
  disableFollowUpVariant,
  disableQueue,
  isInputEmpty,
}: UseConversationChatInputUiStateParams): ConversationChatInputUiState => {
  const isInputLoading = useConversationStore(messageStateSelectors.isInputVisiblyLoading);

  return getConversationChatInputUiState({
    disableFollowUpVariant,
    disableQueue,
    isInputEmpty,
    isInputLoading,
  });
};
