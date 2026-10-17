import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { GoalManagerService, goalPlanSchema } from '@/server/services/goal/manager';
import { GoalReportStore, type SubmitGoalReportInput } from '@/server/services/goal/reportStore';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { assertWorkspaceRowManageable } from '../_helpers/assertWorkspaceRowManageable';
import { goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';

/**
 * A wrap-up report submitted from a run. The metadata passes through as a
 * record: `GoalReportStore.submit` parses it with the report schema and checks
 * every reference against the Goal graph.
 */
const reportInput = idInput.extend({
  operationId: z.string().min(1),
  report: z.object({
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()),
  }),
});

export const planningProcedures = {
  // A plan is an operation result; the turn token further restricts ingestion to its Goal.
  submitOperationPlan: heteroAuthedProcedure
    .use(serverDatabase)
    .input(
      idInput.extend({
        token: z.string().min(1),
        operationId: z.string().min(1),
        plan: goalPlanSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
          operationId: input.operationId,
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
      const data = await new GoalManagerService(
        ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ).submit(input.id, input.token, input.operationId, input.plan);
      await scheduleGoalAdvance({
        goalId: input.id,
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      return { data, success: true };
    }),
  // The wrap-up report of a heterogeneous agent's run: server tools never reach
  // a device run, so its report arrives through the CLI instead of the tool.
  submitOperationReport: heteroAuthedProcedure
    .use(serverDatabase)
    .input(reportInput)
    .mutation(async ({ ctx, input }) => {
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
          operationId: input.operationId,
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
      const data = await new GoalReportStore(
        ctx.serverDB,
        principal.userId,
        principal.workspaceId,
      ).submitFromOperation(input.id, input.report as SubmitGoalReportInput, input.operationId);
      return { data, success: true };
    }),
  submitReport: goalWriteProcedure.input(reportInput).mutation(async ({ ctx, input }) => {
    const data = await new GoalReportStore(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
    ).submitFromOperation(input.id, input.report as SubmitGoalReportInput, input.operationId);
    return { data, success: true };
  }),
  submitPlan: goalWriteProcedure
    .input(
      idInput.extend({
        token: z.string().min(1),
        operationId: z.string().min(1),
        plan: goalPlanSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data = await new GoalManagerService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
      ).submit(input.id, input.token, input.operationId, input.plan);
      await scheduleGoalAdvance({
        goalId: input.id,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId ?? undefined,
      });
      return { data, success: true };
    }),
  /**
   * Answer a goal's clarification round at once. One advance follows all the
   * answers, so the re-plan never starts with half of them.
   */
  answerClarifications: goalWriteProcedure
    .input(
      idInput.extend({
        answers: z
          .array(
            z.object({
              decisionId: z.string().uuid(),
              optionId: z.string(),
              resolution: z.string().optional(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await ctx.goalService.answerClarifications(input.id, input.answers);
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'decide',
          userId: ctx.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { message: 'Clarifications answered', success: true };
      } catch (error) {
        mapGoalError(error, 'answer clarifications for');
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
        // Answering the gate is what unblocks the Task; carry on from here.
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
  retireNodes: goalWriteProcedure
    .input(
      idInput.extend({
        nodeIds: z.array(z.string().uuid()).min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Same ownership rule as restart/delete: retiring cancels the nodes'
        // Tasks and recovery gates, so visibility is not manageability.
        const goal = await ctx.goalModel.findById(input.id);
        if (!goal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Goal not found' });
        assertWorkspaceRowManageable(ctx, goal.userId, 'goal');

        const data = await ctx.goalService.retireNodes(input.id, input.nodeIds, input.reason);
        // Retiring can unpark the goal or clear the last unfinished task. Advance
        // as the goal's owner: a workspace owner retiring a colleague's nodes
        // cannot see that colleague's private Tasks, so an advance under the
        // caller would read their bound nodes as `missing_task`.
        await scheduleGoalAdvance({
          goalId: input.id,
          trigger: 'manual',
          userId: goal.userId,
          workspaceId: ctx.workspaceId ?? undefined,
        });
        return { data, message: `Retired ${data.retiredNodeIds.length} node(s)`, success: true };
      } catch (error) {
        mapGoalError(error, 'retireNodes');
      }
    }),
};
