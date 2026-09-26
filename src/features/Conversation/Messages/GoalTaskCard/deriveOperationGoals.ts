import type { AssistantContentBlock, ChatToolPayloadWithResult } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';

export interface OperationGoal {
  criteriaCount: number;
  /** The `goals` row the tool created — the card's pointer and its link target. */
  goalId: string;
  name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const deriveBuiltinGoal = (tool: ChatToolPayloadWithResult): OperationGoal[] => {
  if (!['lobe-goal', 'lobe-task'].includes(tool.identifier) || tool.apiName !== 'createGoal')
    return [];
  if (tool.result?.error || !isRecord(tool.result?.state) || tool.result.state.success !== true)
    return [];

  const goalId = nonEmptyString(tool.result.state.goalId);
  if (!goalId) return [];

  const parsedArgs = safeParseJSON(tool.arguments);
  const args = isRecord(parsedArgs) ? parsedArgs : undefined;
  const name = nonEmptyString(tool.result.state.name) ?? nonEmptyString(args?.name) ?? goalId;
  const criteriaCount = Array.isArray(args?.criteria) ? args.criteria.length : 0;

  return [{ criteriaCount, goalId, name }];
};

const GOAL_CREATE_COMMAND = /\blh\s+goal\s+create\b/;
const GOAL_URL_ID = /\/goal\/(goal_[A-Za-z0-9]+)/;
const GOAL_BARE_ID = /\b(goal_[A-Za-z0-9]+)\b/;
const CREATE_TITLE = /\blh\s+goal\s+create\s+"([^"\n]+)"|\blh\s+goal\s+create\s+'([^'\n]+)'/;
const CRITERION_FLAG = /--criterion\b/g;

/**
 * Shell tools name their command differently per CLI: Claude Code and Kimi pass
 * a `command` string, Codex passes a string array.
 */
const shellCommand = (args: Record<string, unknown> | undefined): string | undefined => {
  const command = args?.command;
  if (typeof command === 'string') return command;
  if (Array.isArray(command))
    return command.filter((part): part is string => typeof part === 'string').join(' ');
  return undefined;
};

/**
 * A heterogeneous agent (Claude Code, Kimi, Codex…) never receives the builtin
 * Goal tool — its `/goal` instructions tell it to run `lh goal create` in its
 * own shell instead, so the created goal only exists as a shell command plus
 * its stdout in the tool result. Recover the card's pointer from that pair. The
 * output is not always parseable: a long graph snapshot is truncated mid-JSON
 * and the shell can append its own notices, so the id falls back from the
 * `--json` output's `goal.id` to the printed goal URL to the first bare
 * `goal_*` id — a create call's output only ever names the goal it created.
 */
const deriveCliGoal = (tool: ChatToolPayloadWithResult): OperationGoal[] => {
  if (tool.result?.error) return [];

  const parsedArgs = safeParseJSON(tool.arguments);
  const command = shellCommand(isRecord(parsedArgs) ? parsedArgs : undefined) ?? tool.arguments;
  if (!GOAL_CREATE_COMMAND.test(command)) return [];

  const content = nonEmptyString(tool.result?.content);
  if (!content) return [];

  const output = safeParseJSON(content.trim());
  const goal = isRecord(output) && isRecord(output.goal) ? output.goal : undefined;
  const goalId =
    nonEmptyString(goal?.id) ?? GOAL_URL_ID.exec(content)?.[1] ?? GOAL_BARE_ID.exec(content)?.[1];
  if (!goalId) return [];

  const titleMatch = CREATE_TITLE.exec(command);

  return [
    {
      criteriaCount: command.match(CRITERION_FLAG)?.length ?? 0,
      goalId,
      name: nonEmptyString(goal?.title) ?? titleMatch?.[1] ?? titleMatch?.[2] ?? goalId,
    },
  ];
};

/**
 * Derive Goal artifacts from the completed createGoal calls in one assistant
 * group — the builtin Goal tool for server-side agents, an `lh goal create`
 * shell call for heterogeneous ones. Like the edited-files aggregate, this is
 * display-only: no Work row is created and nothing enters Work Gallery/history.
 */
export const deriveOperationGoals = (blocks: AssistantContentBlock[] = []): OperationGoal[] => {
  const goals = blocks.flatMap((block) =>
    (block.tools ?? []).flatMap((tool) => {
      const builtin = deriveBuiltinGoal(tool);
      return builtin.length > 0 ? builtin : deriveCliGoal(tool);
    }),
  );

  return [...new Map(goals.map((goal) => [goal.goalId, goal])).values()];
};
