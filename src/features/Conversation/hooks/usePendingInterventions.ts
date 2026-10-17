import { dataSelectors, useConversationStore } from '../store';
import { isSamePendingInterventionList } from '../store/slices/data/pendingInterventions';
import { useUnexpiredInterventions } from './useDeadlineClock';

/**
 * The conversation's unexpired pending approval / question cards.
 *
 * Custom equality: the selector builds a new list on every store change, and
 * without it any store update → new ref → re-render → Intervention's store
 * writes → loop. The deadline filter drops a card the moment its producer stops
 * waiting, even when nothing in the store moves.
 *
 * Kept out of `PendingInterventionBar` so non-UI consumers such as
 * `AssistantTurnSettledWatcher` do not pull in the whole intervention UI tree.
 */
export const usePendingInterventions = () => {
  const selected = useConversationStore(
    dataSelectors.pendingInterventions,
    isSamePendingInterventionList,
  );
  return useUnexpiredInterventions(selected);
};
