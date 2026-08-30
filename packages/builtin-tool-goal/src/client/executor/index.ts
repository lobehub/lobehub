import { taskExecutor } from '@lobechat/builtin-tool-task/client/executor';
import type {
  BuiltinToolContext,
  BuiltinToolResult,
  GoalGraphSnapshot,
  ToolAfterCallContext,
} from '@lobechat/types';
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
        createdByAgentId: ctx.agentId,
        config: {
          recovery: { maxAttemptsPerTask: resolveGoalAttemptBudget(params.maxIterations) },
        },
        // `maxIterations` caps attempts on one Work; it is deliberately not
        // passed as `maxRounds`, which counts runs across every Work in the
        // graph and would strand later tasks that have not run at all.
        maxTotalCost: params.maxTotalCost ?? undefined,
        requirement: buildGoalRequirement(params.name, criteria, params.instruction),
        title: params.name,
        work: [{ description: params.instruction, title: params.name }],
      });

      return await this.reportCreatedGoal(graph, criteria.length, params.name);
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

  /**
   * The goal is committed by the time this runs, so kickoff failure must never
   * be reported as creation failure: an agent told the goal was not created
   * makes another one, and both then do the same paid work. `goal.create`
   * already queued an advance server-side, so a failure here costs nothing more
   * than the immediate feedback.
   */
  private reportCreatedGoal = async (
    graph: GoalGraphSnapshot,
    criteriaCount: number,
    name: string,
  ): Promise<BuiltinToolResult> => {
    const created = `Goal "${graph.goal.title}" created with ${criteriaCount} acceptance criteria.`;
    const tail =
      'Execution continues in its own task; do not perform or reproduce the work in this conversation.';

    try {
      const advance = await goalService.advance(graph.goal.id);
      return {
        content: `${created} ${advance.message}. ${tail}`,
        state: {
          goalId: graph.goal.id,
          name,
          startedAt: new Date().toISOString(),
          success: true,
          taskId: advance.taskId,
        },
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start it right away';
      return {
        content: `${created} It has not started yet (${message}); the server will pick it up. Do not create it again. ${tail}`,
        state: {
          goalId: graph.goal.id,
          name,
          startedAt: new Date().toISOString(),
          success: true,
        },
        success: true,
      };
    }
  };
}

export const goalExecutor = new GoalExecutor();
