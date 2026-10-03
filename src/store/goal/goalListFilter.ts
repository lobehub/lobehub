import { type GoalStatus, goalStatuses } from '@lobechat/const/goal';

import type { GoalListFilter } from './initialState';

/**
 * Lifecycle states each list tab keeps, as an explicit partition rather than a
 * predicate per tab: the tab's rows and the server query behind them can then
 * never disagree, and a status a later lifecycle adds has one place to land.
 *
 * `null` means "every status" — `all` is the default, so a goal is never hidden
 * by default.
 */
const goalListFilterStatuses: Record<GoalListFilter, GoalStatus[] | null> = {
  all: null,
  review: ['review'],
  running: ['running'],
};

/** Every status, as a fresh array so a caller cannot mutate a shared list. */
const allGoalStatuses = (): GoalStatus[] => [...goalStatuses];

/**
 * The tab's statuses, as the server query argument.
 *
 * The list read loads one page of the newest goals, so a tab asks the server for
 * exactly its own states instead of filtering that page: otherwise a busy
 * agent's older matching goal falls past the page, and the tab reports itself
 * empty while the goal exists.
 */
export const goalStatusesForFilter = (filter: GoalListFilter): GoalStatus[] =>
  goalListFilterStatuses[filter] ?? allGoalStatuses();

/**
 * Goal list rows kept by the active tab.
 *
 * This is the instant paint while the tab's own read is in flight. It is never
 * the evidence that a tab is empty — that claim waits for the server's answer.
 */
export const filterGoalsByStatus = <T extends { goal: { status: GoalStatus } }>(
  goals: T[],
  filter: GoalListFilter,
): T[] => {
  const keptStatuses = goalListFilterStatuses[filter];

  return keptStatuses ? goals.filter(({ goal }) => keptStatuses.includes(goal.status)) : goals;
};
