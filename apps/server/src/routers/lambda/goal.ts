import { goalStatuses } from '@lobechat/const/goal';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { GoalModel } from '@/database/models/goal';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalService } from '@/server/services/goal';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

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
        kind: z.enum(['problem', 'task', 'finding', 'decision']),
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
        /** Set by the `/goal` tool so the seeded graph is authored by the agent. */
        createdByAgentId: z.string().optional(),
        config: z
          .object({
            // Bounds mirror `resolveMaxConcurrentTasks`, so a rejected value and
            // a clamped one cannot disagree about what the cap may be.
            maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
            recovery: z
              .object({
                maxAttemptsPerTask: z.number().int().positive().optional(),
                maxStepsPerRun: z.number().int().positive().nullable().optional(),
                operationLeaseTimeoutMs: z.number().int().min(60_000).optional(),
              })
              .optional(),
            schedule: z
              .object({
                /** ISO-8601 instant; past it the coordinator stops dispatching. */
                deadline: z.string().datetime().nullable().optional(),
              })
              .optional(),
          })
          .optional(),
        maxRounds: z.number().int().positive().optional(),
        maxTotalCost: z.number().positive().optional(),
/** Structured acceptance criteria — persisted rows that gate the terminal acceptance. */
        criteria: z
          .array(
            z.object({
              description: z.string().optional(),
              instruction: z.string().optional(),
              title: z.string().min(1),
            }),
          )
          .optional(),
        problemDescription: z.string().optional(),
        projectId: z.string().optional(),
        requirement: z.string().optional(),
        title: z.string().min(1),
        work: z
          .array(
            z.union([
              z.string().min(1),
              z.object({ description: z.string().optional(), title: z.string().min(1) }),
            ]),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.goalService.create(input);
        // A goal is not a document — creating one means starting it. The
        // coordinator takes it from here without a client holding a loop open.
        await scheduleGoalAdvance({
          goalId: data.goal.id,
          trigger: 'create',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Goal created', success: true };
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
        const data = await ctx.goalService.decide(
          input.id,
          input.decisionId,
          input.optionId,
          input.resolution,
        );
        // Answering the gate is what unblocks the Work; carry on from here.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'decide',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Decision resolved', success: true };
      } catch (error) {
        mapGoalError(error, 'decide');
      }
    }),

  /**
   * Run the coordinator now and report where it stopped.
   *
   * The goal advances on its own — this is the "don't wait for the next event"
   * nudge, so the surface can hand off in one call instead of holding a tick
   * loop open in the browser.
   */
  advance: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const { result, ticks } = await advanceGoal({
        goalId: input.id,
        trigger: 'manual',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data: { ...result, ticks }, message: result.message, success: true };
    } catch (error) {
      mapGoalError(error, 'advance');
    }
  }),

  /**
   * Delete a goal and, by FK cascade, its whole graph. Anything still running
   * is stopped first; the Work Tasks themselves are deliberately left in place
   * — they are ordinary tasks with their own history and acceptance.
   */
  delete: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      // `agent:update` says the member may change goals; it does not say whose.
      // Without this any member could delete a colleague's goal and cascade its
      // whole graph away, which is the same rule tasks already enforce.
      const goal = await ctx.goalModel.findById(input.id);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

      await ctx.goalService.delete(input.id);
      return { message: 'Goal deleted', success: true };
    } catch (error) {
      mapGoalError(error, 'delete');
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
   * List goals with their graph roll-up: how much Work is done, how many
   * decision gates wait on a human, and what the exploration has cost.
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
      const data = await ctx.goalService.resume(input.id);
      await scheduleGoalAdvance({
        goalId: input.id,
        trigger: 'resume',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data, message: 'Goal resumed', success: true };
    } catch (error) {
      mapGoalError(error, 'resume');
    }
  }),

  /** Rebind which persisted verify criteria gate this goal's terminal acceptance. */
  setAcceptanceCriteria: goalWriteProcedure
    .input(idInput.extend({ criteriaIds: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.goalService.setAcceptanceCriteria(input.id, input.criteriaIds);
        return { success: true };
      } catch (error) {
        mapGoalError(error, 'setAcceptanceCriteria');
      }
    }),

  setBudget: goalWriteProcedure
    .input(
      idInput.extend({
        /** ISO-8601 calendar-time budget; null clears the deadline. */
        deadline: z.string().datetime().nullable().optional(),
        maxRounds: z.number().int().positive().nullable().optional(),
        maxTotalCost: z.number().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input: { id, ...budget } }) => {
      try {
        const data = await ctx.goalService.setBudget(id, budget);
        // Raising a budget is how a user un-sticks a goal that stopped on one;
        // it should start moving again without a second gesture.
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'budget',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Goal budget updated', success: true };
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

  updateRequirement: goalWriteProcedure
    .input(idInput.extend({ requirement: z.string().min(1) }))
    .mutation(async ({ ctx, input: { id, requirement } }) => {
      try {
        return { data: await ctx.goalService.updateRequirement(id, requirement), success: true };
      } catch (error) {
        mapGoalError(error, 'updateRequirement');
      }
    }),
});
