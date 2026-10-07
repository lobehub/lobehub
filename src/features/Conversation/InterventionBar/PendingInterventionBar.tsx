import { memo } from 'react';

import { useUnexpiredInterventions } from '../hooks/useDeadlineClock';
import { dataSelectors, useConversationStore } from '../store';
import { isSamePendingInterventionList } from '../store/slices/data/pendingInterventions';
import InterventionBar from './index';

/**
 * The conversation's unexpired pending approval / question cards.
 *
 * Custom equality: the selector builds a new list on every store change, and
 * without it any store update → new ref → re-render → Intervention's store
 * writes → loop. The deadline filter drops a card the moment its producer stops
 * waiting, even when nothing in the store moves.
 */
export const usePendingInterventions = () => {
  const selected = useConversationStore(
    dataSelectors.pendingInterventions,
    isSamePendingInterventionList,
  );
  return useUnexpiredInterventions(selected);
};

/**
 * The conversation's pending approval / question cards, self-selected from the
 * ConversationStore. For surfaces that render their own composer instead of
 * `ChatInput` (which mounts the bar itself), e.g. the Agent Share visitor page.
 */
const PendingInterventionBar = memo(() => {
  const interventions = usePendingInterventions();

  if (interventions.length === 0) return null;

  return <InterventionBar interventions={interventions} />;
});

PendingInterventionBar.displayName = 'PendingInterventionBar';

export default PendingInterventionBar;
