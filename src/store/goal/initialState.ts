import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

export type GoalListItem = TaskGroupItem['tasks'][number];
export type GoalListFilter = 'active' | 'all';
export type GoalViewMode = 'card' | 'list';

export interface GoalState {
  goalListFilter: GoalListFilter;
  goalListVisibleLimit: number;
  goalViewMode: GoalViewMode;
  /**
   * Every agent's goals, for the home rail's cross-agent roll-up — keyed by
   * cache scope, because goals are workspace rows: a singleton would let a
   * slower response from the workspace you just left overwrite this one's, and
   * render titles and links that cannot resolve here.
   */
  homeGoalsByScope: Record<string, GoalListItem[]>;
  homeGoalsInitializedScopes: string[];
}

export const initialState: GoalState = {
  goalListFilter: 'active',
  goalListVisibleLimit: 10,
  goalViewMode: 'list',
  homeGoalsByScope: {},
  homeGoalsInitializedScopes: [],
};
