import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { GoalObjectiveError, GoalObjectiveService } from '@/server/services/goal/objective';

import { goalProcedure, goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';
import { goalRunOperationProcedure } from './runOperation';

const objectiveInput = z.object({
  direction: z.enum(['max', 'min']),
  evaluator: z.string().min(1).max(4000),
  key: z
    .string()
    .regex(/^[\w.-]{1,100}$/)
    .optional(),
  timeoutSeconds: z.number().int().min(10).max(86_400).optional(),
  title: z.string().max(200).optional(),
});

const evaluationInput = z.object({
  durationMs: z.number().int().min(0).optional(),
  fingerprint: z.string().max(128).optional(),
  metrics: z.record(z.string().max(100), z.number().finite()).optional(),
  score: z.number().finite(),
  summary: z.string().max(4000).optional(),
  valid: z.boolean(),
});

const mapObjectiveError = (error: unknown, operation: string): never => {
  if (error instanceof GoalObjectiveError)
    throw new TRPCError({ cause: error, code: error.code, message: error.message });
  return mapGoalError(error, operation);
};

const objectiveServiceFor = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => new GoalObjectiveService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

const operationObjectiveProcedure = goalRunOperationProcedure.use(async (opts) =>
  opts.next({
    ctx: {
      objectiveService: new GoalObjectiveService(
        opts.ctx.serverDB,
        opts.ctx.principal.userId,
        opts.ctx.principal.workspaceId,
      ),
    },
  }),
);

export const objectiveRouter = router({
  /** The objective and its leaderboard; `data` is null when the goal has none. */
  objective: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return {
        data: (await objectiveServiceFor(ctx).leaderboard(input.id)) ?? null,
        success: true,
      };
    } catch (error) {
      mapObjectiveError(error, 'read the objective of');
    }
  }),

  /** The same read for a Goal Task run, for its own goal. */
  objectiveOperation: operationObjectiveProcedure.query(async ({ ctx }) => {
    try {
      return {
        data: (await ctx.objectiveService.leaderboard(ctx.run.goalId, ctx.run.nodeId)) ?? null,
        goalId: ctx.run.goalId,
        success: true,
      };
    } catch (error) {
      mapObjectiveError(error, 'read the objective of');
    }
  }),

  /** A person records an evaluation they ran themselves (lane `manual`). */
  recordEvaluation: goalWriteProcedure
    .input(idInput.merge(evaluationInput))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return { data: await objectiveServiceFor(ctx).recordEvaluation(id, input), success: true };
      } catch (error) {
        mapObjectiveError(error, 'record an evaluation on');
      }
    }),

  /** A Goal Task run records the evaluation of its working directory, in its lane. */
  recordEvaluationOperation: operationObjectiveProcedure
    .input(evaluationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.objectiveService.recordEvaluation(ctx.run.goalId, input, {
          agentId: ctx.run.agentId,
          nodeId: ctx.run.nodeId,
          operationId: ctx.run.operationId,
          taskId: ctx.run.taskId,
        });
        return { data, success: true };
      } catch (error) {
        mapObjectiveError(error, 'record an evaluation on');
      }
    }),

  /** Set the objective, or clear it with `objective: null`. */
  setObjective: goalWriteProcedure
    .input(idInput.extend({ objective: objectiveInput.nullable() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await objectiveServiceFor(ctx).setObjective(input.id, input.objective);
        return { data, message: data ? 'Objective set' : 'Objective cleared', success: true };
      } catch (error) {
        mapObjectiveError(error, 'set the objective of');
      }
    }),
});
