import type { GoalListItem } from '@/services/goal';

import type { GoalStore } from './action';

const EMPTY_GOALS: GoalListItem[] = [];

const goalGraph = (goalId?: string | null) => (s: GoalStore) =>
  goalId ? s.goalGraphById[goalId] : undefined;

const goalMetricSeries = (goalId?: string | null) => (s: GoalStore) =>
  goalId ? s.goalMetricSeriesById[goalId] : undefined;

/** One list entry by its replica key — the scope itself for `all`, a tab's own key otherwise. */
const goalListView = (entryKey: string) => (s: GoalStore) => s.goalListByAgentId[entryKey];

/** The `all` rows of one scope; the narrow tabs read their own entry through `goalListView`. */
const goalList = (scope: string) => (s: GoalStore) =>
  s.goalListByAgentId[scope]?.goals ?? EMPTY_GOALS;

const homeGoals = (scope: string) => (s: GoalStore) =>
  s.homeGoalsByScope[scope]?.goals ?? EMPTY_GOALS;

export const goalSelectors = {
  goalGraph,
  goalList,
  goalListView,
  goalMetricSeries,
  homeGoals,
};
