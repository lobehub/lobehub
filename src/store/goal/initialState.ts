import type { GoalGraphSnapshot } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import type { GoalListItem } from '@/services/goal';
import type { MetricSeriesWithPoints } from '@/services/metric';

import type { GoalListValue } from './projection';

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
  /**
   * Goal Graph snapshots keyed by `goals.id` — the process-control surface's
   * read model.
   */
  goalGraphById: Record<string, GoalGraphSnapshot>;
  /** Local-first bookkeeping for `goalGraphById`. */
  goalGraphReplica: ReplicaState<GoalGraphSnapshot>;
  /**
   * Goal lists keyed by the tab's entry key: the scope's own entry for `all`
   * (what the project dashboard and the route meta read) and one sibling entry
   * per narrow tab (`goalListKey`).
   */
  goalListByAgentId: Record<string, GoalListValue>;
  goalListFilter: GoalListFilter;
  /** Local-first bookkeeping for `goalListByAgentId`. */
  goalListReplica: ReplicaState<GoalListValue>;
  goalListVisibleLimit: number;
  /**
   * North-star series of a goal (subjectType 'goal'), points included. Keyed
   * by goal id like the graph snapshot — the strip and the graph describe the
   * same row and refresh together.
   */
  goalMetricSeriesById: Record<string, MetricSeriesWithPoints[]>;
  /** Local-first bookkeeping for `goalMetricSeriesById`. */
  goalMetricSeriesReplica: ReplicaState<MetricSeriesWithPoints[]>;
  goalViewMode: GoalViewMode;
  /**
   * Every agent's goals, for the home rail's cross-agent roll-up — keyed by
   * cache scope, because goals are workspace rows: a singleton would let a
   * slower response from the workspace you just left overwrite this one's, and
   * render titles and links that cannot resolve here.
   */
  homeGoalsByScope: Record<string, GoalListValue>;
  /** Local-first bookkeeping for `homeGoalsByScope`. */
  homeGoalsReplica: ReplicaState<GoalListValue>;
}

export const initialState: GoalState = {
  goalGraphById: {},
  goalGraphReplica: createReplicaState(),
  goalListByAgentId: {},
  goalListFilter: 'all',
  goalListReplica: createReplicaState(),
  goalListVisibleLimit: 10,
  goalMetricSeriesById: {},
  goalMetricSeriesReplica: createReplicaState(),
  goalViewMode: 'list',
  homeGoalsByScope: {},
  homeGoalsReplica: createReplicaState(),
};
