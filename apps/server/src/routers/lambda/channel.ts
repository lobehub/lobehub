import { CHANNEL_LIMITS } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ChannelError } from '@/database/repositories/channel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ChannelService } from '@/server/services/channel/ChannelService';
import { isChannelEnabled } from '@/server/services/channel/featureGate';

import { channelHistoryProcedures } from './channelHistory';

const channelId = z.string().regex(/^chn_[\dA-Za-z]{12}$/);
const threadId = z.string().regex(/^cht_[\dA-Za-z]{12}$/);
const agentSelection = z.object({
  agentId: z.string().min(1),
  description: z.string().max(1000).optional(),
  deviceId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  workingDirectory: z.string().trim().min(1).max(4096).optional(),
});
const channelProcedure = wsCompatProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!(await isChannelEnabled(ctx.userId)))
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Channels are not enabled for this account',
    });
  const result = await next({
    ctx: {
      channelService: new ChannelService(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
  if (!result.ok && result.error.cause instanceof ChannelError) {
    const cause = result.error.cause;
    throw new TRPCError({ cause, code: cause.code, message: cause.message });
  }
  return result;
});

export const channelRouter = router({
  ...channelHistoryProcedures,
  userCandidates: channelProcedure
    .input(z.object({ channelId, search: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.userCandidates(input.channelId, input.search),
      success: true,
    })),
  archive: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    await ctx.channelService.archive(input.channelId);
    return { success: true };
  }),
  archiveThread: channelProcedure
    .input(z.object({ channelId, threadId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.archiveThread(input.channelId, input.threadId);
      return { success: true };
    }),
  addAgent: channelProcedure
    .input(z.object({ channelId, agent: agentSelection }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.addAgent(input.channelId, input.agent),
      success: true,
    })),
  agentEnvironment: channelProcedure
    .input(z.object({ channelId, memberId: z.uuid() }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.agentEnvironment(input.channelId, input.memberId),
      success: true,
    })),
  updateAgentEnvironment: channelProcedure
    .input(
      z.object({
        channelId,
        environment: agentSelection.pick({ deviceId: true, workingDirectory: true }),
        memberId: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.updateAgentEnvironment(
        input.channelId,
        input.memberId,
        input.environment,
      ),
      success: true,
    })),
  addUser: channelProcedure
    .input(z.object({ channelId, userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.addUser(input.channelId, input.userId),
      success: true,
    })),
  create: channelProcedure
    .input(
      z.object({
        agents: z.array(agentSelection).min(1).max(20),
        projectId: z.string().min(1).optional(),
        title: z.string().trim().min(1).max(CHANNEL_LIMITS.titleLength),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.create(input),
      success: true,
    })),
  detail: channelProcedure
    .input(
      z.object({
        before: z.number().int().positive().optional(),
        channelId,
        limit: z.number().int().min(1).max(100).optional(),
        threadId: threadId.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.detail(input.channelId, input),
      success: true,
    })),
  list: channelProcedure.query(async ({ ctx }) => ({
    data: await ctx.channelService.repository.list(),
    success: true,
  })),
  markRead: channelProcedure
    .input(z.object({ channelId, sequence: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.markRead(input.channelId, input.sequence),
      success: true,
    })),
  remove: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    await ctx.channelService.remove(input.channelId);
    return { success: true };
  }),
  rename: channelProcedure
    .input(z.object({ channelId, title: z.string().trim().min(1).max(CHANNEL_LIMITS.titleLength) }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.rename(input.channelId, input.title),
      success: true,
    })),
  removeThread: channelProcedure
    .input(z.object({ channelId, threadId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.removeThread(input.channelId, input.threadId);
      return { success: true };
    }),
  retryRouting: channelProcedure
    .input(z.object({ channelId, messageId: z.uuid() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.retryRouting(input.channelId, input.messageId),
      success: true,
    })),
  send: channelProcedure
    .input(
      z.object({
        channelId,
        content: z.string().max(CHANNEL_LIMITS.contentLength),
        fileIds: z.array(z.string().min(1)).max(CHANNEL_LIMITS.attachments).optional(),
        mentions: z.array(z.uuid()).max(100).optional(),
        requestKey: z.string().min(1).max(200),
        rootMessageId: z.uuid().optional(),
        threadId: threadId.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.send(input.channelId, input),
      success: true,
    })),
  stop: channelProcedure
    .input(
      z.object({
        channelId,
        scope: z.union([
          z.object({ jobId: z.uuid() }),
          z.object({ threadId: threadId.nullable() }),
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.stop(input.channelId, input.scope);
      return { success: true };
    }),
  unarchive: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    await ctx.channelService.unarchive(input.channelId);
    return { success: true };
  }),
  unarchiveThread: channelProcedure
    .input(z.object({ channelId, threadId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.unarchiveThread(input.channelId, input.threadId);
      return { success: true };
    }),
});
