/**
 * Shared shaping for the `createGoal` tool between the client executor and the
 * server runtime: both create the same Goal Graph, so the wording the agent and
 * the verifier read must not drift between the two paths.
 */
import type { GoalSchedulePolicy } from '@lobechat/types';

export interface GoalCriterionInput {
  description?: string;
  instruction?: string;
  title: string;
}

/**
 * Attempts one Work gets before the coordinator opens a decision gate.
 *
 * `null` is the manifest's documented "no user-specified cap" — the cleared
 * input field — and must stay distinct from a chosen number, or clearing the
 * field would quietly pin the goal to three attempts. Returning `undefined`
 * leaves `maxAttemptsPerTask` off the config so `resolveTaskAttemptBudget`
 * applies its own default.
 */
export const resolveGoalAttemptBudget = (maxIterations?: number | null): number | undefined =>
  typeof maxIterations === 'number' ? Math.min(10, Math.max(2, maxIterations)) : undefined;

/**
 * The goal's calendar-time budget, as the schedule config the coordinator reads.
 *
 * `null` is the manifest's documented "no user-specified deadline" — the cleared
 * input field — and returns `undefined` so the schedule block stays off the
 * config entirely. An invalid string is dropped rather than stored: a deadline
 * that cannot be parsed would either never fire (silently no budget) or fire
 * immediately (silently paused goal), and both hide the mistake from the user.
 */
export const resolveGoalScheduleConfig = (
  deadline?: string | null,
): GoalSchedulePolicy | undefined => {
  if (typeof deadline !== 'string' || deadline.trim() === '') return undefined;
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return { deadline: parsed.toISOString() };
};

/**
 * The goal's acceptance requirement. The Goal Graph models "what counts as
 * done" as one authoritative text, which the coordinator folds into every
 * Work's acceptance contract — so the drafted criteria are rendered into it
 * rather than persisted as separate verify criteria rows.
 */
export const buildGoalRequirement = (
  name: string,
  criteria: GoalCriterionInput[],
  instruction?: string,
): string =>
  [
    name,
    instruction ? `Scope: ${instruction}` : undefined,
    'Acceptance criteria — every one must be satisfied with concrete evidence:',
    ...criteria.map((item, index) =>
      [
        `${index + 1}. ${item.title}`,
        item.description ? ` — ${item.description}` : '',
        item.instruction ? ` (how to judge: ${item.instruction})` : '',
      ].join(''),
    ),
  ]
    .filter(Boolean)
    .join('\n');
