import type { AssistantContentBlock } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';

export interface OperationGoal {
  criteriaCount: number;
  identifier: string;
  maxRounds?: number;
  name: string;
  taskId: string;
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

      const identifier = nonEmptyString(tool.result.state.identifier);
      const taskId = nonEmptyString(tool.result.state.taskId);
      if (!identifier || !taskId) return [];

      const parsedArgs = safeParseJSON(tool.arguments);
      const args = isRecord(parsedArgs) ? parsedArgs : undefined;
      const name =
        nonEmptyString(tool.result.state.name) ?? nonEmptyString(args?.name) ?? identifier;
      const criteriaCount = Array.isArray(args?.criteria) ? args.criteria.length : 0;
      const maxRounds = typeof args?.maxIterations === 'number' ? args.maxIterations : undefined;

      return [{ criteriaCount, identifier, maxRounds, name, taskId }];
    }),
  );

  return [...new Map(goals.map((goal) => [goal.taskId, goal])).values()];
};
