import { ChatInput } from '@lobehub/editor/react';
import { memo, useCallback, useMemo, useState } from 'react';

import { type PendingIntervention } from '../store/slices/data/pendingInterventions';
import InterventionContent from './InterventionContent';
import InterventionTabBar from './InterventionTabBar';
import { styles } from './style';

interface InterventionBarProps {
  interventions: PendingIntervention[];
}

const InterventionBar = memo<InterventionBarProps>(({ interventions }) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actionsPortalTarget, setActionsPortalTarget] = useState<HTMLDivElement | null>(null);

  // Derive the active index from the stored toolCallId.
  // Falls back to the first intervention when the previously active one is resolved.
  const activeIndex = useMemo(() => {
    if (activeId) {
      const idx = interventions.findIndex((i) => i.toolCallId === activeId);
      if (idx >= 0) return idx;
    }
    return 0;
  }, [interventions, activeId]);

  const handleTabChange = useCallback(
    (index: number) => {
      setActiveId(interventions[index]?.toolCallId ?? null);
    },
    [interventions],
  );

  const activeIntervention = interventions[activeIndex];
  if (!activeIntervention) return null;

  return (
    <ChatInput
      className={styles.container}
      footer={<div className={styles.actions} ref={setActionsPortalTarget} />}
      maxHeight={'50vh' as any}
      resize={false}
    >
      {interventions.length > 1 && (
        <InterventionTabBar
          activeIndex={activeIndex}
          interventions={interventions}
          onTabChange={handleTabChange}
        />
      )}
      <InterventionContent
        actionsPortalTarget={actionsPortalTarget}
        intervention={activeIntervention}
        key={activeIntervention.toolCallId}
      />
    </ChatInput>
  );
});

export default InterventionBar;
