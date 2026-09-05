import type { GoalGraphSnapshot } from '@lobechat/types';

import type { GoalListItem } from '@/services/goal';

export type { GoalListItem };
export type GoalListFilter = 'active' | 'all';
export type GoalViewMode = 'card' | 'list';

export interface GoalState {
  /** Goal Graph snapshots keyed by `goals.id` — the process-control surface's read model. */
  goalGraphById: Record<string, GoalGraphSnapshot>;
  goalListByAgentId: Record<string, GoalListItem[]>;
  goalListFilter: GoalListFilter;
  goalListInitializedAgentIds: string[];
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
  goalGraphById: {},
  goalListByAgentId: {},
  goalListFilter: 'active',
  goalListInitializedAgentIds: [],
  goalListVisibleLimit: 10,
  goalViewMode: 'list',
  homeGoalsByScope: {},
  homeGoalsInitializedScopes: [],
};
