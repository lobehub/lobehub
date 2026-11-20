import type { GateDecisionKind } from '@/features/Acceptance/Viewer/Gate';
import { useGoalStore } from '@/store/goal';

import { useOpenGoalConversation } from '../goalConversation';

/**
 * What the goal page does once its release gate is decided: the graph moves on
 * either way, and a plan sent back opens the goal's conversation — the
 * correction goes to the main Agent as a message, so the owner sees it sent
 * and the agent take it up instead of the gate going quiet.
 */
export const useReleaseGateDecided = (goalId: string) => {
  const refreshGoalGraph = useGoalStore((s) => s.refreshGoalGraph);
  const openGoalConversation = useOpenGoalConversation();
  return async (outcome: GateDecisionKind) => {
    const refreshed = refreshGoalGraph(goalId);
    if (outcome !== 'revise') return void refreshed;
    // The send-back handed the correction over within its request: read the
    // goal with that hand-off first, so the panel opens on it straight away.
    await refreshed.catch(() => {});
    openGoalConversation?.();
  };
};
