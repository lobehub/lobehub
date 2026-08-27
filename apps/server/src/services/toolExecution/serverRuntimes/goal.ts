import {
  buildGoalRequirement,
  GoalIdentifier,
  resolveGoalAttemptBudget,
} from '@lobechat/builtin-tool-goal';

import { GoalService } from '@/server/services/goal';

import type { ServerRuntimeRegistration } from './types';

/**
 * Server-side `/goal`: create a Goal Graph and advance it once.
 *
 * It lives in its own runtime rather than on the task runtime because a goal is
 * no longer a task with a `goals` row attached — the graph owns the
 * decomposition and dispatches its own Work Tasks.
 */
export const goalRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for Goal tool execution');
    }
    const { agentId, serverDB, userId, workspaceId } = context;

    return {
      createGoal: async (args: {
        criteria: Array<{ description?: string; instruction?: string; title: string }>;
        instruction: string;
        maxIterations?: number | null;
        maxTotalCost?: number | null;
        name: string;
      }) => {
        if (!agentId) return { content: 'A goal needs the current agent.', success: false };

        const drafts = (args.criteria ?? []).filter((item) => item.title?.trim());
        if (drafts.length === 0) {
          return { content: 'A goal needs at least one acceptance criterion.', success: false };
        }

        try {
          const goalService = new GoalService(serverDB, userId, workspaceId ?? undefined);
          const graph = await goalService.create({
            agentId,
            config: {
              recovery: { maxAttemptsPerWork: resolveGoalAttemptBudget(args.maxIterations) },
            },
            maxRounds: args.maxIterations ?? undefined,
            maxTotalCost: args.maxTotalCost ?? undefined,
            requirement: buildGoalRequirement(args.name, drafts, args.instruction),
            title: args.name,
            work: [{ description: args.instruction, title: args.name }],
          });
          // One tick dispatches the opening Work: the coordinator creates its
          // responsible task, its acceptance contract, and starts the run.
          const tick = await goalService.tick(graph.goal.id);

          return {
            content: `Goal "${graph.goal.title}" created with ${drafts.length} acceptance criteria. ${tick.message}. Execution continues in its own task; do not perform or reproduce the work in this conversation.`,
            state: {
              goalId: graph.goal.id,
              name: args.name,
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
            state: { name: args.name, success: false },
            success: false,
          };
        }
      },
    };
  },
  identifier: GoalIdentifier,
};
