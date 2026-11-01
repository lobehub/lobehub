import {
  buildGoalRequirement,
  GoalIdentifier,
  resolveGoalAttemptBudget,
  resolveGoalScheduleConfig,
} from '@lobechat/builtin-tool-goal';

import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

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
        deadline?: string | null;
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
          const scheduleConfig = resolveGoalScheduleConfig(args.deadline);
          const graph = await goalService.create({
            agentId,
            createdByAgentId: agentId,
            config: {
              recovery: { maxAttemptsPerTask: resolveGoalAttemptBudget(args.maxIterations) },
              ...(scheduleConfig ? { schedule: scheduleConfig } : {}),
            },
            // `maxIterations` caps attempts on one Work; it is deliberately not
            // passed as `maxRounds`, which counts runs across every Work in the
            // graph and would strand later tasks that have not run at all.
            // Structured criteria persist alongside the prose requirement so the
            // goal page can edit them and the terminal acceptance runs exactly them.
            criteria: drafts,
            maxTotalCost: args.maxTotalCost ?? undefined,
            // No seed work: the coordinator plans the decomposition on first
            // advance, so a complex ask becomes several explorable directions
            // instead of one task that mirrors the whole request.
            problemDescription: args.instruction,
            requirement: buildGoalRequirement(args.name, drafts, args.instruction),
            title: args.name,
          });
          // The TRPC `goal.create` route queues this; calling the service
          // directly does not. Without it the "the server will pick it up"
          // promise below is false — outside queue mode there is no local timer
          // for the goal and no recurring sweep, so it would sit in `planning`
          // while the agent has been told not to create it again.
          await scheduleGoalAdvance({
            goalId: graph.goal.id,
            trigger: 'create',
            userId,
            workspaceId: workspaceId ?? undefined,
          });

          const created = `Goal "${graph.goal.title}" created with ${drafts.length} acceptance criteria.`;
          const tail =
            'Execution continues in its own task; do not perform or reproduce the work in this conversation.';

          // The goal is committed. Kickoff failure must not be reported as
          // creation failure — an agent told the goal was not created makes
          // another one, and both then do the same paid work. `goal.create`
          // already queued an advance, so this is only about immediate feedback.
          try {
            // Advance until the coordinator is waiting on something other than a
            // tick — normally that is the first Work Task executing. From there
            // the goal keeps itself moving through the queued advances.
            const { result } = await advanceGoal({
              goalId: graph.goal.id,
              trigger: 'create',
              userId,
              workspaceId: workspaceId ?? undefined,
            });

            return {
              content: `${created} ${result.message}. ${tail}`,
              state: {
                goalId: graph.goal.id,
                name: args.name,
                startedAt: new Date().toISOString(),
                success: true,
                taskId: result.taskId,
              },
              success: true,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Could not start it right away';
            return {
              content: `${created} It has not started yet (${message}); the server will pick it up. Do not create it again. ${tail}`,
              state: {
                goalId: graph.goal.id,
                name: args.name,
                startedAt: new Date().toISOString(),
                success: true,
              },
              success: true,
            };
          }
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
