import { GOAL_MARK_KINDS } from '@lobechat/const/goal';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import {
  GoalMarkError,
  GoalMarkService,
  MARK_DESCRIPTION_MAX,
  MARK_TITLE_MAX,
} from '@/server/services/goal/marks';

import { goalProcedure, goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';
import { goalRunOperationProcedure } from './runOperation';

const markInput = z.object({
  description: z.string().max(MARK_DESCRIPTION_MAX).optional(),
  kind: z.enum(GOAL_MARK_KINDS),
  title: z.string().min(1).max(MARK_TITLE_MAX),
});

const mapMarkError = (error: unknown, operation: string): never => {
  if (error instanceof GoalMarkError)
    throw new TRPCError({ cause: error, code: error.code, message: error.message });
  return mapGoalError(error, operation);
};

const markServiceFor = (ctx: {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}) => new GoalMarkService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined);

const markOperationProcedure = goalRunOperationProcedure.use(async (opts) =>
  opts.next({
    ctx: {
      markService: new GoalMarkService(
        opts.ctx.serverDB,
        opts.ctx.principal.userId,
        opts.ctx.principal.workspaceId,
      ),
    },
  }),
);

export const markRouter = router({
  addMark: goalWriteProcedure
    .input(idInput.merge(markInput))
    .mutation(async ({ ctx, input: { id, ...input } }) => {
      try {
        return { data: await markServiceFor(ctx).add(id, input), success: true };
      } catch (error) {
        mapMarkError(error, 'add a mark to');
      }
    }),

  addMarkOperation: markOperationProcedure.input(markInput).mutation(async ({ ctx, input }) => {
    try {
      const data = await ctx.markService.add(ctx.run.goalId, input, {
        agentId: ctx.run.agentId,
        nodeId: ctx.run.nodeId,
      });
      return { data, success: true };
    } catch (error) {
      mapMarkError(error, 'add a mark to');
    }
  }),

  judgeMarkOperation: markOperationProcedure
    .input(z.object({ markId: z.string().uuid(), verdict: z.enum(['confirms', 'refutes']) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const data = await ctx.markService.judge(ctx.run.goalId, input.markId, input.verdict, {
          agentId: ctx.run.agentId,
          nodeId: ctx.run.nodeId,
        });
        return { data, success: true };
      } catch (error) {
        mapMarkError(error, 'judge a mark of');
      }
    }),

  marks: goalProcedure.input(idInput).query(async ({ ctx, input }) => {
    try {
      return { data: await markServiceFor(ctx).list(input.id), success: true };
    } catch (error) {
      mapMarkError(error, 'list the marks of');
    }
  }),

  marksOperation: markOperationProcedure.query(async ({ ctx }) => {
    try {
      return {
        data: await ctx.markService.list(ctx.run.goalId),
        goalId: ctx.run.goalId,
        success: true,
      };
    } catch (error) {
      mapMarkError(error, 'list the marks of');
    }
  }),

  retireMark: goalWriteProcedure
    .input(idInput.extend({ markId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await markServiceFor(ctx).retire(input.id, input.markId, input.reason);
        return { message: 'Mark retired', success: true };
      } catch (error) {
        mapMarkError(error, 'retire a mark of');
      }
    }),
});
