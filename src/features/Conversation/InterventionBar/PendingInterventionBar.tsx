import { memo } from 'react';

import { usePendingInterventions } from '../hooks/usePendingInterventions';
import InterventionBar from './index';

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
