import { taskExecutor } from '@lobechat/builtin-tool-task/client/executor';
import type { BuiltinToolContext, BuiltinToolResult, ToolAfterCallContext } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { goalService } from '@/services/goal';

import { buildGoalRequirement, resolveGoalAttemptBudget } from '../../createGoalInput';
import { GoalIdentifier } from '../../manifest';
import type { CreateGoalParams } from '../../types';
import { GoalApiName } from '../../types';

/**
 * `/goal` creates a Goal Graph, not a task with a goal row attached: the graph
 * owns the decomposition, dispatches its own Work Tasks and their acceptance
 * contracts, and stops on a decision gate when a Work runs out of attempts.
 * The drafted criteria become the goal's acceptance requirement, which the
 * coordinator folds into every Work contract it writes.
 */
class GoalExecutor extends BaseExecutor<typeof GoalApiName> {
  readonly identifier = GoalIdentifier;
  protected readonly apiEnum = GoalApiName;

  onAfterCall = async (context: ToolAfterCallContext): Promise<void> => {
    await taskExecutor.onAfterCall(context);
  };

  createGoal = async (
    params: CreateGoalParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (!ctx?.agentId) {
      return {
        content: 'A goal needs the current agent as its assignee.',
        error: { message: 'agentId is required', type: 'MissingAgent' },
        success: false,
      };
    }

    const criteria = (params.criteria ?? []).filter((item) => item.title?.trim());
    if (criteria.length === 0) {
      return {
        content: 'A goal needs at least one acceptance criterion.',
        error: { message: 'criteria array is empty', type: 'EmptyCriteria' },
        success: false,
      };
    }

    try {
      const graph = await goalService.create({
        agentId: ctx.agentId,
        config: {
          recovery: { maxAttemptsPerWork: resolveGoalAttemptBudget(params.maxIterations) },
        },
        maxRounds: params.maxIterations ?? undefined,
        maxTotalCost: params.maxTotalCost ?? undefined,
        requirement: buildGoalRequirement(params.name, criteria, params.instruction),
        title: params.name,
        work: [{ description: params.instruction, title: params.name }],
      });

      // One tick dispatches the first Work: the coordinator creates the
      // responsible task with its own acceptance contract and starts the run.
      const tick = await goalService.tick(graph.goal.id);

      return {
        content: `Goal "${graph.goal.title}" created with ${criteria.length} acceptance criteria. ${tick.message}. Execution continues in its own task; do not perform or reproduce the work in this conversation.`,
        state: {
          goalId: graph.goal.id,
          name: params.name,
          startedAt: new Date().toISOString(),
          success: true,
          taskId: tick.taskId,
        },
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create the goal';
      return {
        content: `Could not create the goal: ${message}`,
        error: { message, type: 'GoalCreateFailed' },
        state: { name: params.name, success: false },
        success: false,
      };
    }
  };
}

export const goalExecutor = new GoalExecutor();
