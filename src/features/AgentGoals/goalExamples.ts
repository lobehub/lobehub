import { GOAL_MAX_ROUNDS_RANGE } from '@lobechat/const/verify';

/**
 * The seeded examples on the goal empty state.
 *
 * They are the screen's teaching device as much as a shortcut: each one shows
 * what a *judgeable* outcome reads like (a deliverable, a boundary, a verdict),
 * which is the part users get wrong when they write their first goal.
 */
export const GOAL_EXAMPLE_KEYS = ['backlog', 'digest', 'metric'] as const;

export type GoalExampleKey = (typeof GOAL_EXAMPLE_KEYS)[number];

/** Round budgets per example. Must stay inside {@link GOAL_MAX_ROUNDS_RANGE}. */
export const GOAL_EXAMPLE_ROUND_BUDGETS: Record<GoalExampleKey, number> = {
  backlog: 5,
  digest: 3,
  metric: 5,
};

export interface GoalExampleSeed {
  requirement: string;
  roundBudget: number;
  title: string;
}

/**
 * Resolve one example into the seed the create-goal modal is opened with.
 * `translate` is passed in so this stays a pure function of the locale table.
 */
export const buildGoalExampleSeed = (
  key: GoalExampleKey,
  translate: (key: string) => string,
): GoalExampleSeed => ({
  requirement: translate(`goalEmpty.examples.${key}.requirement`),
  roundBudget: GOAL_EXAMPLE_ROUND_BUDGETS[key],
  title: translate(`goalEmpty.examples.${key}.title`),
});
