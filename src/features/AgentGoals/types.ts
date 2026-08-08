import type { GoalListItem } from '@/store/goal/initialState';

export interface GoalItemProps {
  hideAchieved?: boolean;
  task: GoalListItem;
}
