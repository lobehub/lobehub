import { GOAL_MARK_KINDS } from '@lobechat/const/goal';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { LobeChatDatabase } from '@/database/type';
import { heteroAuthedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  GoalMarkError,
  GoalMarkService,
  MARK_DESCRIPTION_MAX,
  MARK_TITLE_MAX,
} from '@/server/services/goal/marks';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

import { goalProcedure, goalWriteProcedure, idInput, mapGoalError } from '../goalProcedures';

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

/**
 * The run a device or gateway Task holds an operation token for, and the Goal
 * Task node it works for.
 *
 * Marks are left mid-run, by exactly the runs that hold operation tokens — and
 * `oidcAuth` refuses those on ordinary routes. The Goal is never an input: it
 * is the one whose Task node the operation runs, so a token reaches the marks
 * of its own Goal and no other. `hetero:ingest` is what every such run already
 * carries.
 */
const markOperationProcedure = heteroAuthedProcedure.use(serverDatabase).use(async (opts) => {
  if (opts.ctx.heteroAuthKind !== 'operation' || !opts.ctx.heteroOperation) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'An operation-bound token is required' });
  }
  let principal;
  try {
    principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'hetero:ingest',
      claims: opts.ctx.heteroOperation,
      db: opts.ctx.serverDB,
      operationId: opts.ctx.heteroOperation.operation_id,
    });
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
  const markService = new GoalMarkService(
    opts.ctx.serverDB,
    principal.userId,
    principal.workspaceId,
  );
  const run = await markService.runNode(principal.operationId);
  if (!run) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This run does not work for a Goal Task, so it has no Goal marks',
    });
  }
  return opts.next({ ctx: { markService, run } });
});

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
