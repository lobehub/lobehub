import { goalStatuses } from '@lobechat/const/goal';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GoalModel } from '@/database/models/goal';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';

const goalProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      goalModel: new GoalModel(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
      goalService: new GoalService(
        opts.ctx.serverDB,
        opts.ctx.userId,
        opts.ctx.workspaceId ?? undefined,
      ),
    },
  }),
);
const goalWriteProcedure = goalProcedure.use(withScopedPermission('agent:update'));
const idInput = z.object({ id: z.string() });

function mapGoalError(error: unknown, operation: string): never {
  if (error instanceof TRPCError) throw error;
  console.error(`[goal:${operation}]`, error);
  throw new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Failed to ${operation} goal`,
  });
}

export const goalRouter = router({
  addEdge: goalWriteProcedure
    .input(
      idInput.extend({
        kind: z.enum([
          'decomposes',
          'depends_on',
          'investigates',
          'produces',
          'supports',
          'contradicts',
          'leads_to',
        ]),
        sourceNodeId: z.string().uuid(),
        targetNodeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return {
          data: await ctx.goalService.addEdge(
            id,
            input.sourceNodeId,
            input.targetNodeId,
            input.kind,
          ),
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'addEdge');
      }
    }),

  addNode: goalWriteProcedure
    .input(
      idInput.extend({
        description: z.string().optional(),
        kind: z.enum(['problem', 'work', 'finding', 'decision']),
        priority: z.number().int().optional(),
        status: z
          .enum(['proposed', 'active', 'waiting', 'resolved', 'rejected', 'retired'])
          .optional(),
        title: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return { data: await ctx.goalService.addNode(id, input), success: true };
      } catch (error) {
        mapGoalError(error, 'addNode');
      }
    }),

  create: goalWriteProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        config: z
          .object({
            recovery: z
              .object({
                maxAttemptsPerWork: z.number().int().positive().optional(),
                maxStepsPerRun: z.number().int().positive().nullable().optional(),
              })
              .optional(),
          })
          .optional(),
        maxRounds: z.number().int().positive().optional(),
        maxTotalCost: z.number().positive().optional(),
        projectId: z.string().optional(),
        requirement: z.string().optional(),
        title: z.string().min(1),
        work: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: await ctx.goalService.create(input),
          message: 'Goal created',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'create');
      }
    }),

  decide: goalWriteProcedure
    .input(
      idInput.extend({
        decisionId: z.string().uuid(),
        optionId: z.string(),
        resolution: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          data: await ctx.goalService.decide(
            input.id,
            input.decisionId,
            input.optionId,
            input.resolution,
          ),
          message: 'Decision resolved',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'decide');
      }
    }),

  graph: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.graph(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'graph');
    }
  }),

  /**
   * List goals. Each item is the execution-carrier task with the goal row
   * attached (`goal`) plus subtree run statistics (`totalRunCost` /
   * `totalRunDuration`), shaped TaskItem-compatible for the existing goal UI.
   */
  list: goalProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        projectId: z.string().optional(),
        statuses: z.array(z.enum(goalStatuses)).optional(),
      }),
    )
    .query(async ({ input, ctx }) => ctx.goalModel.list(input)),

  pause: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.pause(input.id), message: 'Goal paused', success: true };
    } catch (error) {
      mapGoalError(error, 'pause');
    }
  }),

  resume: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return {
        data: await ctx.goalService.resume(input.id),
        message: 'Goal resumed',
        success: true,
      };
    } catch (error) {
      mapGoalError(error, 'resume');
    }
  }),

  setBudget: goalWriteProcedure
    .input(
      idInput.extend({
        maxRounds: z.number().int().positive().nullable().optional(),
        maxTotalCost: z.number().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...budget } }) => {
      try {
        return {
          data: await ctx.goalService.setBudget(id, budget),
          message: 'Goal budget updated',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'setBudget');
      }
    }),

  tick: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.tick(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'tick');
    }
  }),
});
