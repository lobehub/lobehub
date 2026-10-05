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

// `lh` must be in command position — the start of the command, or right after
// a separator (`&&`, `||`, `;`, `|`, `(`, newline), optionally behind env
// assignments or a path. As a mere argument (`echo lh goal create x`) it never ran.
// Scanned token by token rather than with one regex: a pattern that has to try
// every separator, env assignment and path prefix backtracks polynomially.
const COMMAND_SEPARATOR = /[;&|(\n]/g;
const TOKEN_PATTERN = /\S+/g;
const ENV_ASSIGNMENT_PATTERN = /^[A-Z_]\w*=/i;
const GOAL_VERBS = new Set(['create', 'plan']);
const FIRST_POSITIONAL_PATTERN = /^\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'-]\S*))/;

const isLhBinary = (token: string) => token === 'lh' || token.endsWith('/lh');

/** The first `lh goal <verb>` in command position, and everything after its verb. */
const findGoalCall = (command: string): { rest: string; verb: string } | undefined => {
  let start = 0;
  while (start <= command.length) {
    COMMAND_SEPARATOR.lastIndex = start;
    const end = COMMAND_SEPARATOR.exec(command)?.index ?? command.length;
    const tokens = [...command.slice(start, end).matchAll(TOKEN_PATTERN)];

    let index = 0;
    while (index < tokens.length && ENV_ASSIGNMENT_PATTERN.test(tokens[index][0])) index += 1;

    const verb = tokens[index + 2];
    if (
      verb &&
      isLhBinary(tokens[index][0]) &&
      tokens[index + 1][0] === 'goal' &&
      GOAL_VERBS.has(verb[0])
    ) {
      return { rest: command.slice(start + verb.index + verb[0].length), verb: verb[0] };
    }

    start = end + 1;
  }
};

export const getGoalCommand = (command?: string): GoalCommand | undefined => {
  const call = findGoalCall(getRunCommandDisplayCommand(command));
  if (!call) return;

  const { rest, verb } = call;
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

/**
 * Whether a settled `lh goal` step failed. A shell step reports failure either
 * as a tool error or only through its run state (`success: false` with a
 * nonzero exit code); every surface that labels the step must read both.
 */
export const isGoalCommandFailed = (result?: {
  error?: unknown;
  state?: { exitCode?: number; success?: boolean } | null;
}): boolean =>
  !!result?.error || (result?.state?.success === false && result?.state?.exitCode !== 0);
