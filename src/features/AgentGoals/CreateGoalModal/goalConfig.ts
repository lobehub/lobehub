import {
  DEFAULT_GOAL_MAX_ROUNDS,
  DEFAULT_MAX_REPAIR_ROUNDS,
  GOAL_MAX_ROUNDS_RANGE,
} from '@lobechat/const/verify';
import type { TaskGoalConfig, TaskVerifyConfig } from '@lobechat/types';

/**
 * A type alias rather than an interface on purpose: `createTask` takes
 * `config?: Record<string, unknown>`, and only aliases get the implicit index
 * signature that makes them assignable to it.
 */
export type GoalTaskConfig = {
  goal: TaskGoalConfig;
  verify: TaskVerifyConfig;
};

export interface BuildGoalTaskConfigParams {
  /**
   * Total USD budget across all rounds and their verify runs. `null`/`undefined`
   * = uncapped (the user left it blank); a number is clamped to be non-negative.
   */
  costBudget?: number | null;
  /** What the user typed as the goal itself; the acceptance fallback. */
  instruction: string;
  /** "What counts as done" — the source the acceptance criteria are generated from. */
  requirement?: string;
  /** Outer-loop budget: how many rounds (task topics) the goal may spawn. */
  roundBudget?: number | null;
  /** User-reviewed acceptance criteria generated before the goal is created. */
  verifyCriteriaIds?: string[];
}

/**
 * Seed the review step with a usable criterion even when the user started from
 * a free-form description instead of an example with a dedicated requirement.
 */
export const deriveInitialGoalCriterionTitle = (
  instruction: string,
  requirement?: string,
): string => requirement?.trim() || instruction.trim();

/**
 * Build the `tasks.config` payload that marks a task as a goal root.
 *
 * The two `maxIterations` under this config look alike and mean different
 * things, which is exactly how they got conflated before this existed: the
 * create-goal modal reused the task modal and wrote the *same* number into both,
 * so a goal created with a 10-round budget also bought 10 auto-repair re-runs
 * inside every round — up to 100 agent runs for one goal.
 *
 * - `goal.maxIterations`   — outer loop, rounds. User-facing ("轮次预算").
 * - `goal.maxTotalCost`    — outer loop, total USD across all rounds. User-facing ("成本预算").
 * - `verify.maxIterations` — inner loop, repair re-runs within one round.
 *   Not user-facing; pinned to the platform default.
 */
export const buildGoalTaskConfig = ({
  costBudget,
  instruction,
  requirement,
  roundBudget,
  verifyCriteriaIds,
}: BuildGoalTaskConfigParams): GoalTaskConfig => {
  const acceptance = requirement?.trim() || instruction.trim();

  return {
    goal: {
      // `null` is the user's explicit "no cap" and must survive; `undefined`
      // means they never chose, which falls back to the documented default.
      maxIterations:
        roundBudget === null
          ? null
          : typeof roundBudget === 'number'
            ? Math.min(GOAL_MAX_ROUNDS_RANGE.max, Math.max(GOAL_MAX_ROUNDS_RANGE.min, roundBudget))
            : DEFAULT_GOAL_MAX_ROUNDS,
      // No cap unless the user set a positive number; the loop reads `null` as
      // uncapped, so an empty / non-positive input maps back to `null`.
      maxTotalCost: typeof costBudget === 'number' && costBudget > 0 ? costBudget : null,
    },
    verify: {
      enabled: true,
      maxIterations: DEFAULT_MAX_REPAIR_ROUNDS,
      // Drives criteria generation on the first run (`planInstantiation`'s
      // holistic fallback), so an empty one would leave the goal unjudgeable.
      requirement: acceptance,
      verifyCriteriaIds,
    },
  };
};
