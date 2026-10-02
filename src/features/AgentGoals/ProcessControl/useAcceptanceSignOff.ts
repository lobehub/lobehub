import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { verifyService } from '@/services/verify';
import { useGoalStore } from '@/store/goal';

import type { AcceptanceLevel } from './goalAcceptanceTree';

/** Only a level the server can decide is one the owner can sign off. */
const isAcceptable = (level: AcceptanceLevel) =>
  level.state === 'awaitingSignOff' && Boolean(level.acceptanceId);

export interface AcceptanceSignOff {
  acceptAll: () => void;
  acceptLevel: (level: AcceptanceLevel) => Promise<void>;
  /** The waiting levels a sweep would sign off, in the order the tree lists them. */
  awaiting: AcceptanceLevel[];
  /** The level whose own sign-off is in flight, so only that row spins. */
  pendingKey: string | null;
}

/**
 * Sign-off for the acceptance hierarchy: one level at a time, or every waiting
 * level in one sweep.
 *
 * Both act on each level's OWN acceptance. A sweep is N independent decisions
 * taken together — never a verdict computed from the levels beneath, and never
 * the goal-level acceptance, which the page signs off in its own decision strip.
 */
export const useAcceptanceSignOff = (
  goalId: string,
  tasks: AcceptanceLevel[],
): AcceptanceSignOff => {
  const { t } = useTranslation('chat');
  const refreshGoalGraph = useGoalStore((state) => state.refreshGoalGraph);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const acceptLevel = useCallback(
    async (level: AcceptanceLevel) => {
      if (!level.acceptanceId) return;
      setPendingKey(level.key);
      try {
        await verifyService.acceptDelivery(level.acceptanceId);
        toast.success({
          placement: 'top',
          title: t('goalProcess.acceptanceHierarchy.accepted', { title: level.node.node.title }),
        });
        await refreshGoalGraph(goalId);
      } catch (cause) {
        console.error('[goal:acceptance-sign-off]', cause);
        toast.error(t('goalProcess.acceptanceHierarchy.acceptError'));
      } finally {
        setPendingKey(null);
      }
    },
    [goalId, refreshGoalGraph, t],
  );

  const awaiting = useMemo(() => tasks.filter(isAcceptable), [tasks]);

  const acceptAll = useCallback(() => {
    const ids = awaiting.map((level) => level.acceptanceId!);
    if (ids.length === 0) return;

    // Sweeping several deliveries at once is worth confirming. The server
    // reports per row what landed rather than voiding the rest when one of them
    // cannot be decided, so the confirmation is about the size of the decision,
    // not about guarding against a partial failure.
    confirmModal({
      cancelText: t('goalProcess.result.signOff.cancel'),
      content: t('goalProcess.acceptanceHierarchy.acceptAllConfirm', { count: ids.length }),
      okText: t('goalProcess.acceptanceHierarchy.acceptAll'),
      title: t('goalProcess.acceptanceHierarchy.acceptAllTitle'),
      onOk: async () => {
        try {
          const { failedIds, updated } = await verifyService.updateAcceptanceStatusBatch(
            ids,
            'accepted',
          );
          if (updated > 0)
            toast.success({
              placement: 'top',
              title: t('goalProcess.acceptanceHierarchy.acceptAllDone', { count: updated }),
            });
          if (failedIds.length > 0)
            toast.error(
              t('goalProcess.acceptanceHierarchy.acceptAllPartial', { count: failedIds.length }),
            );
          await refreshGoalGraph(goalId);
        } catch (cause) {
          console.error('[goal:acceptance-sign-off:sweep]', cause);
          toast.error(t('goalProcess.acceptanceHierarchy.acceptError'));
        }
      },
    });
  }, [awaiting, goalId, refreshGoalGraph, t]);

  return { acceptAll, acceptLevel, awaiting, pendingKey };
};
