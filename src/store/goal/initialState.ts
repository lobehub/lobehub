import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

export type GoalListItem = TaskGroupItem['tasks'][number];
export type GoalListFilter = 'active' | 'all';
export type GoalViewMode = 'card' | 'list';

export interface GoalState {
  goalListByAgentId: Record<string, GoalListItem[]>;
  goalListFilter: GoalListFilter;
  goalListInitializedAgentIds: string[];
  goalListVisibleLimit: number;
  goalViewMode: GoalViewMode;
}

export const initialState: GoalState = {
  goalListByAgentId: {},
  goalListFilter: 'active',
  goalListInitializedAgentIds: [],
  goalListVisibleLimit: 10,
  goalViewMode: 'list',
};
