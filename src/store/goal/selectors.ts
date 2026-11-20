import type { GoalListItem } from '@/services/goal';

import type { GoalStore } from './action';

const EMPTY_GOALS: GoalListItem[] = [];

const goalGraph = (goalId?: string | null) => (s: GoalStore) =>
  goalId ? s.goalGraphById[goalId] : undefined;

const goalMetricSeries = (goalId?: string | null) => (s: GoalStore) =>
  goalId ? s.goalMetricSeriesById[goalId] : undefined;

const isGoalTitleRenaming = (goalId?: string | null) => (s: GoalStore) =>
  !!goalId && s.goalTitleRenamingIds.includes(goalId);

/** One list entry by its replica key — the scope itself for `all`, a tab's own key otherwise. */
const goalListView = (entryKey: string) => (s: GoalStore) => s.goalListByAgentId[entryKey];

/** The `all` rows of one scope; the narrow tabs read their own entry through `goalListView`. */
const goalList = (scope: string) => (s: GoalStore) =>
  s.goalListByAgentId[scope]?.goals ?? EMPTY_GOALS;

const homeGoals = (scope: string) => (s: GoalStore) =>
  s.homeGoalsByScope[scope]?.goals ?? EMPTY_GOALS;

const topicGoals = (topicId?: string | null) => (s: GoalStore) =>
  topicId ? s.topicGoalsByTopicId[topicId]?.goals : undefined;

/**
 * Whether the topic's goal rows came from the server in this session. A row
 * restored from storage carries the status of whenever it was persisted, so a
 * live surface must not present it as the goal's current state until then.
 */
const topicGoalsConfirmed = (topicId?: string | null) => (s: GoalStore) =>
  !!topicId && s.topicGoalsReplica.entries[topicId]?.source === 'server';

export const goalSelectors = {
  goalGraph,
  goalList,
  goalListView,
  goalMetricSeries,
  homeGoals,
  isGoalTitleRenaming,
  topicGoals,
  topicGoalsConfirmed,
};
