import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ChannelError } from '@/database/repositories/channel';
import { heteroAuthedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import type { HeteroOperationCapability } from '@/libs/trpc/utils/internalJwt';
import { ChannelHistoryService } from '@/server/services/channel/ChannelHistoryService';
import { ChannelMessagingService } from '@/server/services/channel/ChannelMessagingService';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';

/**
 * Procedures an external Channel run calls with its operation token: the principal is the
 * run's requester, resolved from the token, never the device owner or a supplied identity.
 */
const operationProcedure = (capability: HeteroOperationCapability) =>
  heteroAuthedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
    if (ctx.heteroAuthKind !== 'operation' || !ctx.heteroOperation)
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Channel tools require the current operation token',
      });
    try {
      const principal = await resolveActiveHeteroOperationPrincipal({
        capability,
        claims: ctx.heteroOperation,
        db: ctx.serverDB,
        operationId: ctx.heteroOperation.operation_id,
      });
      const args = [
        ctx.serverDB,
        principal.userId,
        principal.operationId,
        principal.workspaceId,
      ] as const;
      const result = await next({
        ctx: {
          channelHistory: new ChannelHistoryService(...args),
          channelMessaging: new ChannelMessagingService(...args),
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
        code:
          error.status === 401 ? 'UNAUTHORIZED' : error.status === 409 ? 'CONFLICT' : 'FORBIDDEN',
        message: error.message,
      });
    }
  });

const historyProcedure = operationProcedure('channel:read');
const messagingProcedure = operationProcedure('channel:message');

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
  listChannels: messagingProcedure
    .input(
      z
        .object({
          agentId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(20).optional(),
          query: z.string().max(200).optional(),
        })
        .strict(),
    )
    .query(({ ctx, input }) => ctx.channelMessaging.listChannels(input)),
  sendMessage: messagingProcedure
    .input(
      z
        .object({
          agentIds: z.array(z.string().min(1)).min(1).max(5),
          channelId: z.string().min(1),
          content: z.string().min(1),
          /** Repeat it to retry without posting twice. */
          requestKey: z.string().min(1).max(100),
        })
        .strict(),
    )
    .mutation(({ ctx, input: { requestKey, ...params } }) =>
      ctx.channelMessaging.sendMessage(params, `cli:${requestKey}`),
    ),
};
