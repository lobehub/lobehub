import { TRPCError } from '@trpc/server';

import { GoalMarkModel } from '@/database/models/goalMark';
import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

/**
 * The run a device or gateway Task holds an operation token for, and the Goal
 * Task node it works for.
 *
 * Marks and evaluations come from inside a run, from exactly the runs that hold
 * operation tokens — and `oidcAuth` refuses those on ordinary routes. The Goal
 * is never an input: it is the one whose Task node the operation runs, so a
 * token reaches its own Goal and no other. `hetero:ingest` is what every such
 * run already carries.
 */
export const goalRunOperationProcedure = heteroAuthedProcedure
  .use(serverDatabase)
  .use(async (opts) => {
    if (opts.ctx.heteroAuthKind !== 'operation' || !opts.ctx.heteroOperation) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'An operation-bound token is required',
      });
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
        code:
          error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
        message: error.message,
      });
    }
    const run = await new GoalMarkModel(
      opts.ctx.serverDB,
      principal.userId,
      principal.workspaceId,
    ).findRunNode(principal.operationId);
    if (!run) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This run does not work for a Goal Task',
      });
    }
    return opts.next({
      ctx: {
        principal: { userId: principal.userId, workspaceId: principal.workspaceId },
        run: { ...run, operationId: principal.operationId },
      },
    });
  });
