export interface BuildGoalCreateInputParams {
  /**
   * Total USD budget across all attempts. `null`/`undefined` = uncapped (the
   * user left it blank); a number is clamped to be non-negative.
   */
  costBudget?: number | null;
  /** What the user typed as the goal itself; the acceptance fallback. */
  instruction: string;
  /** "What counts as done" — the source the acceptance criteria were generated from. */
  requirement?: string;
}

export interface GoalCreateInput {
  maxTotalCost: number | null;
  requirement: string;
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
 * Normalize the budget and optional requirement for goal creation.
 */
export const buildGoalCreateInput = ({
  costBudget,
  instruction,
  requirement,
}: BuildGoalCreateInputParams): GoalCreateInput => ({
  // No cap unless the user set a positive number; the coordinator reads `null`
  // as uncapped, so an empty / non-positive input maps back to `null`.
  maxTotalCost: typeof costBudget === 'number' && costBudget > 0 ? costBudget : null,
  requirement: requirement?.trim() || instruction.trim(),
});

/** Keep the reviewed description in both the planning context and goal document. */
export const buildReviewedGoalContent = (instruction: string) => ({
  problemDescription: instruction,
  requirement: instruction,
});
