import type { GoalListItem } from '@/store/goal/initialState';

export interface GoalItemProps {
  /**
   * Set on the cross-agent page: the row names its agent, opens on the bare
   * `/goal/:goalId` route, and refreshes this list scope after a status change.
   */
  globalScopeId?: string;
  goal: GoalListItem;
  projectId?: string;
}
