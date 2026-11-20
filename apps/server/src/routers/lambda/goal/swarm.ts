import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { GoalSwarmService } from '@/server/services/goal/swarm';

import { goalWriteProcedure, mapGoalError } from '../goalProcedures';

export const swarmRouter = router({
  /** Create and start a swarm goal: N lanes optimising one objective until a deadline. */
  createSwarm: goalWriteProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        deadline: z.string().datetime({ offset: true }),
        lanes: z.number().int().min(1).max(8),
        objective: z.object({
          direction: z.enum(['max', 'min']),
          evaluator: z.string().min(1).max(4000),
          key: z
            .string()
            .regex(/^[\w.-]{1,100}$/)
            .optional(),
          timeoutSeconds: z.number().int().min(10).max(86_400).optional(),
          title: z.string().max(200).optional(),
        }),
        requirement: z.string().max(20_000).optional(),
        taskAgentId: z.string().optional(),
        title: z.string().min(1).max(500),
        workspace: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await new GoalSwarmService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
        ).create(input);
        return { data, message: 'Swarm goal started', success: true };
      } catch (error) {
        mapGoalError(error, 'create a swarm');
      }
    }),
});
