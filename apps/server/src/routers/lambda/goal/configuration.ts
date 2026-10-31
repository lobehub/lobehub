import { GOAL_TITLE_MAX_LENGTH } from '@lobechat/const/goal';
import { MAX_GOAL_METRIC_CRITERIA } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';

export const configurationRouter = router({
  /** Declare or clear the numeric clauses gating this goal's acceptance. */
  setMetricCriteria: goalWriteProcedure
    .input(
      idInput.extend({
        metrics: z
          .array(
            z.object({
              key: z.string().min(1).max(255),
              op: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']).optional(),
              target: z.number(),
              title: z.string().max(255).optional(),
            }),
          )
          .max(MAX_GOAL_METRIC_CRITERIA),
        /** `merge` upserts by key server-side; `replace` (default) swaps the list. */
        mode: z.enum(['merge', 'replace']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const goal = await ctx.goalModel.findById(input.id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
        const data = await ctx.goalService.setMetricCriteria(input.id, input.metrics, input.mode);
        // Relaxing a clause can free a goal parked short of acceptance.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'observe',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Metric criteria updated', success: true };
      } catch (error) {
        mapGoalError(error, 'setMetricCriteria');
      }
    }),
  /** Drop declared clauses by key, against the server's current list. */
  removeMetricCriteria: goalWriteProcedure
    .input(idInput.extend({ keys: z.array(z.string().min(1).max(255)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const goal = await ctx.goalModel.findById(input.id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
        const data = await ctx.goalService.removeMetricCriteria(input.id, input.keys);
        // Dropping the last unmet clause frees a goal parked short of acceptance.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'observe',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: 'Metric criteria removed', success: true };
      } catch (error) {
        mapGoalError(error, 'removeMetricCriteria');
      }
    }),
  /**
   * Record a measurement against this goal and let the coordinator react.
   *
   * The graph otherwise only moves when a Task settles, but a long-horizon
   * goal advances when the *world* changes — a follower count, a conversion
   * rate. This is that entry point: it writes to the generic metrics layer
   * (subject = this goal) and schedules an advance, so a goal whose numeric
   * acceptance was the last thing outstanding closes on the observation
   * instead of waiting up to a sweep window.
   */
  recordObservation: goalWriteProcedure
    .input(
      idInput.extend({
        key: z.string().min(1).max(255),
        kind: z.enum(['gauge', 'counter']).optional(),
        observedAt: z.coerce.date().optional(),
        title: z.string().optional(),
        unit: z.string().optional(),
        value: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { id, ...observation } = input;
        const { shouldAdvance, ...data } = await ctx.goalService.recordObservation(id, observation);
        // A goal parked short of its measured acceptance is only worth waking
        // when the measurement actually cleared the gate; otherwise the advance
        // would tick straight back out as `goal_paused`.
        if (shouldAdvance) {
          await scheduleGoalAdvance({
            goalId: id,
            trigger: 'observe',
            userId: ctx.userId,
            workspaceId: ctx.workspaceId ?? undefined,
          });
        }
        return { data, message: 'Observation recorded', success: true };
      } catch (error) {
        mapGoalError(error, 'recordObservation');
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
  /**
   * Hand the goal to a different agent — the one that supervises and plans it.
   * When that agent also does the goal's Tasks, unfinished ones follow by
   * default (`goalOnly` keeps them); Tasks mid-run switch on their next attempt.
   */
  setAgent: goalWriteProcedure
    .input(idInput.extend({ agentId: z.string().min(1), goalOnly: z.boolean().optional() }))
    .mutation(async ({ ctx, input: { id, agentId, goalOnly } }) => {
      try {
        // Same ownership rule as restart/delete: visibility is not
        // manageability, so only the goal's owner may hand it to a new agent.
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setAgent(id, agentId, { goalOnly });
        const reassigned = data.reassignedTaskIds.length;
        return {
          data,
          message: reassigned
            ? `Goal agent updated; ${reassigned} task(s) reassigned`
            : 'Goal agent updated',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'setAgent');
      }
    }),
  /**
   * Route the goal's Tasks to a dedicated executor (`null` hands them back to
   * the goal agent). Unfinished Tasks follow unless `goalOnly` is set.
   */
  setTaskAgent: goalWriteProcedure
    .input(
      idInput.extend({ agentId: z.string().min(1).nullable(), goalOnly: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input: { id, agentId, goalOnly } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setTaskAgent(id, agentId, { goalOnly });
        const reassigned = data.reassignedTaskIds.length;
        return {
          data,
          message: reassigned
            ? `Task agent updated; ${reassigned} task(s) reassigned`
            : 'Task agent updated',
          success: true,
        };
      } catch (error) {
        mapGoalError(error, 'setTaskAgent');
      }
    }),
  /**
   * Pick the model the goal agent plans with (`null` falls back to the agent's
   * own). Tasks keep their own model.
   */
  setModel: goalWriteProcedure
    .input(
      idInput.extend({
        modelConfig: z.object({ model: z.string().min(1), provider: z.string().min(1) }).nullable(),
      }),
    )
    .mutation(async ({ ctx, input: { id, modelConfig } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setModel(id, modelConfig);
        return { data, message: 'Goal model updated', success: true };
      } catch (error) {
        mapGoalError(error, 'setModel');
      }
    }),
  /**
   * Pick the model the goal's Tasks run on (`null` falls back to their
   * executor's own). Unfinished Tasks switch with it.
   */
  setTaskModel: goalWriteProcedure
    .input(
      idInput.extend({
        modelConfig: z.object({ model: z.string().min(1), provider: z.string().min(1) }).nullable(),
      }),
    )
    .mutation(async ({ ctx, input: { id, modelConfig } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.setTaskModel(id, modelConfig);
        return { data, message: 'Goal task model updated', success: true };
      } catch (error) {
        mapGoalError(error, 'setTaskModel');
      }
    }),
  setBudget: goalWriteProcedure
    .input(
      idInput.extend({
        /** ISO-8601 calendar-time budget; null clears the deadline. */
        deadline: z.string().datetime().nullable().optional(),
        maxAttemptsPerTask: z.number().int().positive().optional(),
        /** null restores the default concurrency. */
        maxConcurrentTasks: z.number().int().min(1).max(10).nullable().optional(),
        maxExperiments: z.number().int().min(1).max(200).optional(),
        /** Main Agent turn cap; only for a goal that has a main Agent. */
        maxManagerTurns: z.number().int().min(1).max(100).optional(),
        maxRounds: z.number().int().positive().nullable().optional(),
        /** null removes the per-run step cap. */
        maxStepsPerRun: z.number().int().positive().nullable().optional(),
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
  updateRequirement: goalWriteProcedure
    .input(idInput.extend({ requirement: z.string().min(1) }))
    .mutation(async ({ ctx, input: { id, requirement } }) => {
      try {
        return { data: await ctx.goalService.updateRequirement(id, requirement), success: true };
      } catch (error) {
        mapGoalError(error, 'updateRequirement');
      }
    }),

  /** Rename the goal; like a topic, a workspace goal is renamed by its creator or an owner. */
  updateTitle: goalWriteProcedure
    .input(idInput.extend({ title: z.string().trim().min(1).max(GOAL_TITLE_MAX_LENGTH) }))
    .mutation(async ({ ctx, input: { id, title } }) => {
      try {
        const goal = await ctx.goalModel.findById(id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');
        return { data: await ctx.goalService.updateTitle(id, title), success: true };
      } catch (error) {
        mapGoalError(error, 'updateTitle');
      }
    }),
});
