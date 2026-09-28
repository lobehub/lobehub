import { getRunCommandDisplayCommand } from './runCommand';

/**
 * An `lh goal` call a CLI agent ran from its shell. `/goal` in a heterogeneous
 * agent conversation reaches LobeHub this way instead of through the builtin
 * goal tool, so these commands are the only record of the goal in the turn.
 */
export type GoalCommand =
  | {
      /** `--conversation`: the goal is bound to, and supervised from, this conversation. */
      conversation: boolean;
      criteriaCount: number;
      kind: 'create';
      title?: string;
    }
  | { goalId?: string; kind: 'plan' };

const LH_GOAL_PATTERN = /(?:^|[\s&(;|])lh\s+goal\s+(create|plan)(?=\s|$)([\s\S]*)$/;
const FIRST_POSITIONAL_PATTERN = /^\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'-]\S*))/;

export const getGoalCommand = (command?: string): GoalCommand | undefined => {
  const match = getRunCommandDisplayCommand(command).match(LH_GOAL_PATTERN);
  if (!match) return;

  const [, verb, rest] = match;
  const positional = rest.match(FIRST_POSITIONAL_PATTERN);
  const value = positional
    ? (positional[1]?.replaceAll(/\\(.)/g, '$1') ?? positional[2] ?? positional[3])
    : undefined;

  if (verb === 'plan') return { goalId: value, kind: 'plan' };

  return {
    conversation: /(?:^|\s)--conversation(?=\s|$)/.test(rest),
    criteriaCount: rest.match(/(?:^|\s)--criterion(?=\s|$)/g)?.length ?? 0,
    kind: 'create',
    title: value,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The goal an `lh goal create` call produced, read from its output: the
 * `--json` graph snapshot, or — when the output was not JSON or got truncated —
 * the goal id from its printed URL or events.
 */
export const getCreatedGoal = (
  output?: string | null,
): { goalId: string; title?: string } | undefined => {
  if (!output?.trim()) return;

  try {
    const parsed: unknown = JSON.parse(output);
    const goal = isRecord(parsed) ? parsed.goal : undefined;
    if (isRecord(goal) && typeof goal.id === 'string' && goal.id) {
      return {
        goalId: goal.id,
        title: typeof goal.title === 'string' && goal.title ? goal.title : undefined,
      };
    }
  } catch {
    // Not JSON — fall through to the id the output prints.
  }

  const goalId =
    output.match(/\/goal\/(goal_[\w-]+)/)?.[1] ?? output.match(/"goalId":\s*"(goal_[\w-]+)"/)?.[1];

  return goalId ? { goalId } : undefined;
};
