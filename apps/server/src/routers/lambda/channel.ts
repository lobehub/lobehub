import type { BotWakeDecisionPage } from '@lobechat/types';
import { CHANNEL_LIMITS, SIGNAL_DECISION_OUTCOMES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { SCOPE_READ_MAX_LIMIT, SignalDecisionModel } from '@/database/models/signalDecision';
import { ChannelError } from '@/database/repositories/channel';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ChannelService } from '@/server/services/channel/ChannelService';
import { isChannelEnabled } from '@/server/services/channel/featureGate';
import {
  CHANNEL_WAKE_FOLLOWUP_REASONS,
  channelWakeScopeKey,
} from '@/server/services/channel/wakeRecords';
import { WakeConfigInputSchema } from '@/server/services/conversationWake/config';
import { pickWakeJudgeScore } from '@/server/services/conversationWake/judgeScore';

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
  /** Without a Channel, the people a new Channel in this workspace can start with. */
  userCandidates: channelProcedure
    .input(z.object({ channelId: channelId.optional(), search: z.string().max(100).optional() }))
    .query(async ({ ctx, input }) => ({
      data: input.channelId
        ? await ctx.channelService.repository.userCandidates(input.channelId, input.search)
        : await ctx.channelService.repository.newChannelUserCandidates(input.search),
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
  /** The channel's reply strategy and each Agent member's own, as stored; admins only. */
  wakeConfig: channelProcedure.input(z.object({ channelId })).query(async ({ ctx, input }) => ({
    data: await ctx.channelService.repository.wakeConfig(input.channelId),
    success: true,
  })),
  /**
   * Replaces the channel's reply strategy, or with `memberId` that Agent member's own over it.
   * `null` returns it to the defaults. Validated by the same schema IM bots' rules are parsed with.
   */
  updateWakeConfig: channelProcedure
    .input(
      z.object({
        channelId,
        memberId: z.uuid().optional(),
        wake: WakeConfigInputSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: input.memberId
        ? await ctx.channelService.repository.updateMemberWakeConfig(
            input.channelId,
            input.memberId,
            input.wake,
          )
        : await ctx.channelService.repository.updateChannelWakeConfig(input.channelId, input.wake),
      success: true,
    })),
  /**
   * One Agent member's wake decisions in this channel, newest first, from the default read window
   * of `SignalDecisionModel.listByScope`: the same page an IM bot's wake records render.
   */
  listWakeDecisions: channelProcedure
    .input(
      z.object({
        channelId,
        cursor: z.object({ createdAt: z.string().datetime(), id: z.uuid() }).optional(),
        followupOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(SCOPE_READ_MAX_LIMIT).optional(),
        memberId: z.uuid(),
        offset: z.number().int().min(0).optional(),
        outcome: z.enum(SIGNAL_DECISION_OUTCOMES).optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<{ data: BotWakeDecisionPage; success: true }> => {
      const scope = await ctx.channelService.repository.memberWakeRecordScope(
        input.channelId,
        input.memberId,
      );
      if (!scope) return { data: { items: [], total: 0 }, success: true };

      const followups = new Set<string>(CHANNEL_WAKE_FOLLOWUP_REASONS);
      const page = await new SignalDecisionModel(
        ctx.serverDB,
        scope.userId,
        scope.workspaceId ?? undefined,
      ).listByScope({
        cursor: input.cursor,
        finalReasons: input.followupOnly ? [...CHANNEL_WAKE_FOLLOWUP_REASONS] : undefined,
        limit: input.limit,
        offset: input.offset,
        outcome: input.outcome,
        scopeKey: channelWakeScopeKey(input.channelId, input.memberId),
      });

      return {
        data: {
          items: page.items.map(({ labels: _labels, verdicts, ...item }) => ({
            ...item,
            agentLabel: null,
            followup: !!item.finalReason && followups.has(item.finalReason),
            judge: pickWakeJudgeScore(verdicts, item.finalReason) ?? null,
            userLabel: null,
          })),
          nextCursor: page.nextCursor,
          total: page.total,
        },
        success: true,
      };
    }),
  addUser: channelProcedure
    .input(z.object({ channelId, userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.addUser(input.channelId, input.userId),
      success: true,
    })),
  create: channelProcedure
    .input(
      z.object({
        agents: z.array(agentSelection).max(20).default([]),
        projectId: z.string().min(1).optional(),
        title: z.string().trim().min(1).max(CHANNEL_LIMITS.titleLength),
        userIds: z.array(z.string().min(1)).max(100).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.create(input),
      success: true,
    })),
  createGroupFromDirect: channelProcedure
    .input(
      z.object({
        agents: z.array(agentSelection).max(20).default([]),
        channelId,
        title: z.string().trim().min(1).max(CHANNEL_LIMITS.titleLength),
        userIds: z.array(z.string().min(1)).max(100).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.createGroupFromDirect(input.channelId, input),
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
  /**
   * The caller's direct conversation with an Agent, opened on first use for Agents that predate
   * direct Channels. Null when the Agent cannot answer in a Channel (no reachable device).
   */
  openDirect: channelProcedure
    .input(z.object({ agentId: z.string().min(1), localDeviceId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      const access = await ctx.channelService.openDirect(input.agentId, {
        localDeviceId: input.localDeviceId,
      });
      return { data: access?.channel.id ?? null, success: true };
    }),
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
        replyToId: z.uuid().optional(),
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
