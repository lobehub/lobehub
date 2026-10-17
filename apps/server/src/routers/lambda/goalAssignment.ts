import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from './goalProcedures';

/**
 * Who works on a goal and with which model, spread into `goalRouter`. Same
 * ownership rule as restart/delete throughout: visibility is not
 * manageability, so only the goal's owner may change these.
 */
export const goalAssignmentProcedures = {
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
};
