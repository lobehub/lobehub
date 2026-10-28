import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ChannelError } from '@/database/repositories/channel';
import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ChannelHistoryService } from '@/server/services/channel/ChannelHistoryService';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

const historyProcedure = heteroAuthedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation)
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Channel history requires the current operation token',
    });
  try {
    const principal = await resolveActiveHeteroOperationPrincipal({
      capability: 'channel:read',
      claims: ctx.heteroOperation,
      db: ctx.serverDB,
      operationId: ctx.heteroOperation.operation_id,
    });
    const result = await next({
      ctx: {
        channelHistory: new ChannelHistoryService(
          ctx.serverDB,
          principal.userId,
          principal.operationId,
          principal.workspaceId,
        ),
      },
    });
    if (!result.ok && result.error.cause instanceof ChannelError)
      throw new TRPCError({
        cause: result.error.cause,
        code: result.error.cause.code,
        message: result.error.cause.message,
      });
    return result;
  } catch (error) {
    if (!(error instanceof HeteroOperationPrincipalError)) throw error;
    throw new TRPCError({
      cause: error,
      code: error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
      message: error.message,
    });
  }
});

export const channelHistoryProcedures = {
  readMessages: historyProcedure
    .input(
      z
        .object({
          beforeSequence: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .strict(),
    )
    .query(({ ctx, input }) => ctx.channelHistory.readMessages(input)),
  readMessage: historyProcedure
    .input(
      z
        .object({ messageId: z.string().min(1), offset: z.number().int().nonnegative().optional() })
        .strict(),
    )
    .query(({ ctx, input }) => ctx.channelHistory.readMessage(input)),
};
