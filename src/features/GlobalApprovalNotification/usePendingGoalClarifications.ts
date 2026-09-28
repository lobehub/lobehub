import { useMemo } from 'react';
import { useLocation } from 'react-router';

import type { PendingGoalClarification } from '@/features/AgentGoals/GoalClarification';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useGoalStore } from '@/store/goal';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

export interface GoalClarificationGroup {
  agentId: string | null;
  goalId: string;
  questions: PendingGoalClarification[];
  requirement?: string | null;
  title: string;
}

const GOAL_PAGE_PATTERN = /\/goal\/([^/?#]+)/;

/** The goal whose page is on screen, if the route is a goal page. */
export const goalIdFromPath = (pathname: string): string | undefined =>
  GOAL_PAGE_PATTERN.exec(pathname)?.[1];

/**
 * What the island should ask, given where the user is.
 *
 * A goal page is where goal questions already live, so the island stays out
 * of it entirely — even for other goals, which would only pull attention away
 * from the one on screen. Beside a conversation, only the goal open in the
 * portal is skipped: it asks the same questions in place.
 */
export const selectIslandGoalClarifications = (
  groups: GoalClarificationGroup[],
  { onGoalPage, portalGoalId }: { onGoalPage: boolean; portalGoalId?: string },
): GoalClarificationGroup[] =>
  onGoalPage
    ? []
    : groups.filter((group) => group.questions.length > 0 && group.goalId !== portalGoalId);

/** Goal clarification rounds the island should ask, oldest first. */
export const usePendingGoalClarifications = (): GoalClarificationGroup[] => {
  const enabled = useUserStore(labPreferSelectors.enableTopicAcceptance);
  const useFetchPendingClarifications = useGoalStore((s) => s.useFetchPendingClarifications);
  const { data } = useFetchPendingClarifications(enabled);
  const { pathname } = useLocation();
  const portalGoalId = useChatStore(chatPortalSelectors.goalPortalId);

  return useMemo(
    () =>
      selectIslandGoalClarifications(data ?? [], {
        onGoalPage: goalIdFromPath(pathname) !== undefined,
        portalGoalId,
      }),
    [data, pathname, portalGoalId],
  );
};
