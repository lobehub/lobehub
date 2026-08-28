import type { GoalListItem } from '@/store/goal/initialState';

export interface GoalItemProps {
  goal: GoalListItem;
  projectId?: string;
}
