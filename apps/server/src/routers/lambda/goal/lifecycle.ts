import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { advanceGoal } from '@/server/services/goal/advanceGoal';
import { GoalManagerService } from '@/server/services/goal/manager';
import {
  DEFAULT_MANAGER_MAX_TURNS,
  managerTurnsSpent,
} from '@/server/services/goal/recoveryPolicy';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';
import { GoalStartService } from '@/server/services/goal/start';
import { GoalWaitService, goalWakeEventSchema } from '@/server/services/goal/wait';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';

/** What `start` folds into a batch: the probes that run first, and the recipe every unit follows. */
const startRolloutInput = z
  .object({
    probeNodeIds: z.array(z.string().min(1)).min(2).max(10),
    recipe: z.string().trim().min(1).max(8000),
    trigger: z.enum(['canary', 'full']).optional(),
    unitNodeIds: z.array(z.string().min(1)).max(60).optional(),
    variants: z
      .array(
        z.object({
          axis: z.string().trim().min(1).max(120),
          values: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
        }),
      )
      .max(10)
      .optional(),
  })
  .strict();

const startInput = idInput.extend({ rollout: startRolloutInput.optional() });

export const lifecycleProcedures = {
  wake: goalWriteProcedure
    .input(goalWakeEventSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...event } = input;
      const goal = await ctx.goalModel.findById(id);
      if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
      assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
      const data = await new GoalWaitService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).deliver(id, event);
      return { data, success: true };
    }),
  /** Launch a draft goal; until now the coordinator has left its graph alone. */
  start: goalWriteProcedure.input(startInput).mutation(async ({ ctx, input }) => {
    // A draft is its creator's arrangement: in a shared workspace only they or
    // an owner may launch it (and, with a rollout, fold its seed nodes away).
    const goal = await ctx.goalModel.findById(input.id);
    if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
    assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
    try {
      const data = await new GoalStartService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).start(input.id, { rollout: input.rollout });
      await scheduleGoalAdvance({
        goalId: input.id,
        trigger: 'start',
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data, message: 'Goal started', success: true };
    } catch (error) {
      mapGoalError(error, 'start');
    }
  }),
  /** `start` from the goal agent's own run, authenticated by its operation token. */
  startOperation: heteroAuthedProcedure
    .use(serverDatabase)
    .input(startInput.extend({ operationId: z.string().min(1) }))
    .mutation(async ({ ctx, input: { operationId, ...input } }) => {
      if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'An operation-bound token is required',
        });
      }
      let principal;
      try {
        principal = await resolveActiveHeteroOperationPrincipal({
          capability: 'hetero:ingest',
          claims: ctx.heteroOperation,
          db: ctx.serverDB,
          operationId,
        });
      } catch (error) {
        if (!(error instanceof HeteroOperationPrincipalError)) throw error;
        throw new TRPCError({
          cause: error,
          code:
            error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
          message: error.message,
        });
      }
      try {
        const data = await new GoalStartService(
          ctx.serverDB,
          principal.userId,
          principal.workspaceId,
        ).start(input.id, { operationId, rollout: input.rollout });
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'start',
          userId: principal.userId,
          workspaceId: principal.workspaceId,
        });
        return { data, message: 'Goal started', success: true };
      } catch (error) {
        mapGoalError(error, 'start');
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
   * is stopped first; the graph Tasks themselves are deliberately left in place
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
  pause: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.pause(input.id), message: 'Goal paused', success: true };
    } catch (error) {
      mapGoalError(error, 'pause');
    }
  }),
  resume: goalWriteProcedure
    .input(
      idInput.extend({
        /**
         * The owner confirms the planning turn the Goal paused on has ended, so
         * it is settled before resuming instead of pausing the Goal again.
         */
        confirmExit: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.confirmExit)
          await new GoalManagerService(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ).confirmTurnExit(input.id);
        const data = await ctx.goalService.resume(input.id);
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'resume',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        // Resuming does not give the main Agent more turns, so a goal it paused
        // for running out would stop again on the next tick. Say how to continue
        // it instead of leaving the caller to replace it with a new goal.
        const message = managerTurnsSpent(data.config)
          ? `Goal resumed, but its main Agent has used all ${data.config?.manager?.maxTurns ?? DEFAULT_MANAGER_MAX_TURNS} turns and it will pause again. Raise the cap with: lh goal set-budget ${input.id} --max-manager-turns <n>`
          : 'Goal resumed';
        return { data, message, success: true };
      } catch (error) {
        mapGoalError(error, 'resume');
      }
    }),
  /**
   * End the goal by hand — achieved or canceled — and interrupt its live runs.
   * Reopening a closed goal is `resume`.
   */
  close: goalWriteProcedure
    .input(idInput.extend({ status: z.enum(['achieved', 'canceled']) }))
    .mutation(async ({ ctx, input: { id, status } }) => {
      try {
        // Closing cancels live runs, so it carries the same ownership check as restart.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.close(id, status);
        return { data, message: `Goal ${status}`, success: true };
      } catch (error) {
        mapGoalError(error, 'close');
      }
    }),
  /**
   * Start every unfinished Task node over (cancel stale runs, back to
   * `backlog`), optionally under a different agent, and kick the coordinator
   * so the goal begins moving without a second gesture.
   */
  restart: goalWriteProcedure
    .input(idInput.extend({ agentId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input: { id, agentId } }) => {
      try {
        // `agent:update` says the member may change goals; it does not say
        // whose. Without this any member could restart a colleague's visible
        // goal — cancel its live runs and reset its tasks.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.restart(id, { agentId });
        await scheduleGoalAdvance({
          goalId: id,
          trigger: 'restart',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return {
          data,
          message: `Restarted ${data.restartedTaskIds.length} task(s)`,
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'restart');
      }
    }),
  tick: goalWriteProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      return { data: await ctx.goalService.tick(input.id), success: true };
    } catch (error) {
      mapGoalError(error, 'tick');
    }
  }),
};
