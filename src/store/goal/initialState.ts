import type { GoalGraphSnapshot } from '@lobechat/types';

import type { GoalListItem } from '@/services/goal';
import type { MetricSeriesWithPoints } from '@/services/metric';

export type { GoalListItem };
/**
 * List tab. Each option names the lifecycle states it keeps: `all` is the
 * default (nothing hidden), `review` the goals at the human acceptance gate,
 * `running` the goal whose loop is executing right now, `achieved` the goals
 * that reached their terminal outcome. The other terminal states (`failed`,
 * `canceled`) stay reachable through `all` only — "completed" would misname
 * them.
 */
export type GoalListFilter = 'all' | 'review' | 'running' | 'achieved';
export type GoalViewMode = 'card' | 'list';

export interface GoalState {
  /** Goal Graph snapshots keyed by `goals.id` — the process-control surface's read model. */
  goalGraphById: Record<string, GoalGraphSnapshot>;
  goalListByAgentId: Record<string, GoalListItem[]>;
  goalListFilter: GoalListFilter;
  goalListInitializedAgentIds: string[];
  goalListVisibleLimit: number;
  /**
   * North-star series of a goal (subjectType 'goal'), points included. Keyed
   * by goal id like the graph snapshot — the strip and the graph describe the
   * same row and refresh together.
   */
  goalMetricSeriesById: Record<string, MetricSeriesWithPoints[]>;
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
  goalMetricSeriesById: {},
  goalGraphById: {},
  goalListByAgentId: {},
  goalListFilter: 'all',
  goalListInitializedAgentIds: [],
  goalListVisibleLimit: 10,
  goalViewMode: 'list',
  homeGoalsByScope: {},
  homeGoalsInitializedScopes: [],
};
