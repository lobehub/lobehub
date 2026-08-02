import { ChatInput } from '@lobehub/editor/react';
import { memo, useCallback, useMemo, useState } from 'react';

import { useConversationResourceAccess } from '../hooks/useConversationResourceAccess';
import { useConversationStore } from '../store';
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
  const [approveAllLoading, setApproveAllLoading] = useState(false);

  const approveAllToolCalls = useConversationStore((s) => s.approveAllToolCalls);
  // Workspace topics are shared: a view-only member can be looking at a
  // teammate's run and must not drive its approvals — same gate the per-card
  // actions apply.
  const { canUseResource } = useConversationResourceAccess();

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

  const handleApproveAll = useCallback(async () => {
    if (approveAllLoading) return;
    setApproveAllLoading(true);
    try {
      await approveAllToolCalls(interventions.map((i) => i.toolMessageId));
    } finally {
      setApproveAllLoading(false);
    }
  }, [approveAllLoading, approveAllToolCalls, interventions]);

  const activeIntervention = interventions[activeIndex];
  if (!activeIntervention) return null;

  const isBatch = interventions.length > 1;

  return (
    <ChatInput
      data-pending-hotkey-scope
      className={styles.container}
      footer={<div className={styles.actions} ref={setActionsPortalTarget} />}
      maxHeight={'50vh' as any}
      resize={false}
    >
      {isBatch && (
        <InterventionTabBar
          activeIndex={activeIndex}
          approveAllLoading={approveAllLoading}
          interventions={interventions}
          onApproveAll={canUseResource ? handleApproveAll : undefined}
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
