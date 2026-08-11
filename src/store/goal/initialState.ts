import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

export type GoalListItem = TaskGroupItem['tasks'][number];
export type GoalListFilter = 'active' | 'all';
export type GoalViewMode = 'card' | 'list';

export interface GoalState {
  goalListFilter: GoalListFilter;
  goalListVisibleLimit: number;
  goalViewMode: GoalViewMode;
}

export const initialState: GoalState = {
  goalListFilter: 'active',
  goalListVisibleLimit: 10,
  goalViewMode: 'list',
};
