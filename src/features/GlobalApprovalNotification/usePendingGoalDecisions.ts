import type { GoalDecisionOption } from '@lobechat/types';
import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { usePermission } from '@/hooks/usePermission';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import { goalIdFromPath } from './usePendingGoalClarifications';

export interface IslandGoalDecision {
  agentId: string | null;
  decisionId: string;
  description: string | null;
  goalId: string;
  goalTitle: string;
  nodeTitle: string;
  options: GoalDecisionOption[];
  question: string;
  recommendedOptionId: string | null;
  sourceTitle: string | null;
}

export interface IslandGoalSignOff {
  acceptanceId: string;
  agentId: string | null;
  briefId: string;
  goalId: string;
  goalTitle: string;
}

export type IslandGoalItem =
  | { decision: IslandGoalDecision; key: string; type: 'decision' }
  | { key: string; signOff: IslandGoalSignOff; type: 'signOff' };

/**
 * What the island should ask, given where the user is — the same rule as the
 * clarification rounds: a goal page asks its own gates in place, so the island
 * stays out of it; beside a conversation only the goal open in the portal is
 * skipped. Gates go before sign-offs: a gate holds work up, a sign-off closes
 * work already done.
 */
export const selectIslandGoalItems = (
  data: { decisions: IslandGoalDecision[]; signOffs: IslandGoalSignOff[] } | undefined,
  {
    canAnswer,
    onGoalPage,
    portalGoalId,
  }: { canAnswer: boolean; onGoalPage: boolean; portalGoalId?: string },
): IslandGoalItem[] => {
  if (!data || !canAnswer || onGoalPage) return [];
  return [
    ...data.decisions
      .filter((decision) => decision.goalId !== portalGoalId)
      .map((decision) => ({
        decision,
        key: `goal-decision:${decision.decisionId}`,
        type: 'decision' as const,
      })),
    ...data.signOffs
      .filter((signOff) => signOff.goalId !== portalGoalId)
      .map((signOff) => ({
        key: `goal-sign-off:${signOff.acceptanceId}`,
        signOff,
        type: 'signOff' as const,
      })),
  ];
};

/** Goal gates and sign-offs the island should ask, oldest first. */
export const usePendingGoalDecisions = (): IslandGoalItem[] => {
  const enabled = useUserStore(labPreferSelectors.enableGoals);
  const { allowed: canAnswer } = usePermission('create_content');
  const useFetchPendingForIsland = useGoalStore((s) => s.useFetchPendingForIsland);
  const { data } = useFetchPendingForIsland(enabled && canAnswer);
  const { pathname } = useLocation();
  const portalGoalId = useChatStore(chatPortalSelectors.goalPortalId);

  return useMemo(
    () =>
      selectIslandGoalItems(data, {
        canAnswer,
        onGoalPage: goalIdFromPath(pathname) !== undefined,
        portalGoalId,
      }),
    [canAnswer, data, pathname, portalGoalId],
  );
};
