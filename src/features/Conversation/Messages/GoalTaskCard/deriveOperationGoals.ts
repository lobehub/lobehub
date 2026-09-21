import type { AssistantContentBlock } from '@lobechat/types';
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

/**
 * Derive Goal artifacts from the completed createGoal calls in one assistant
 * group. Like the edited-files aggregate, this is display-only: no Work row is
 * created and nothing enters Work Gallery/history.
 */
export const deriveOperationGoals = (blocks: AssistantContentBlock[] = []): OperationGoal[] => {
  const goals = blocks.flatMap((block) =>
    (block.tools ?? []).flatMap((tool) => {
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
    }),
  );

  return [...new Map(goals.map((goal) => [goal.goalId, goal])).values()];
};
