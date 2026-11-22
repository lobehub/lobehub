import type { BotWakeDecisionPage } from '@lobechat/types';
import { CHANNEL_LIMITS, SIGNAL_DECISION_OUTCOMES } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  denyExternalContact,
  wsExternalCompatProcedure,
} from '@/business/server/trpc-middlewares/workspaceAuth';
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

import { projectModelOptions } from './_helpers/projectRights';
import { channelHistoryProcedures } from './channelHistory';

const channelId = z.string().regex(/^chn_[\dA-Za-z]{12}$/);
const threadId = z.string().regex(/^cht_[\dA-Za-z]{12}$/);
const sectionId = z.string().uuid();
const sectionName = z.string().trim().min(1).max(100);
const agentSelection = z.object({
  agentId: z.string().min(1),
  description: z.string().max(1000).optional(),
  deviceId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  workingDirectory: z.string().trim().min(1).max(4096).optional(),
});
const channelBaseProcedure = wsExternalCompatProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) => {
    if (!(await isChannelEnabled(ctx.userId)))
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Channels are not enabled for this account',
      });
    const result = await next({
      ctx: {
        channelService: new ChannelService(
          ctx.serverDB,
          ctx.userId,
          ctx.workspaceId ?? undefined,
          projectModelOptions(ctx),
        ),
      },
    });
    if (!result.ok && result.error.cause instanceof ChannelError) {
      const cause = result.error.cause;
      throw new TRPCError({ cause, code: cause.code, message: cause.message });
    }
    return result;
  });

/**
 * What a workspace's external contact may do in it: their one-on-one conversations with the
 * members open to them. The Channel repository rechecks the pairing on every open and send.
 */
const externalChannelProcedure = channelBaseProcedure;
/** Everything else is for members (and the personal space) only. */
const channelProcedure = channelBaseProcedure.use(denyExternalContact);

export const channelRouter = router({
  ...channelHistoryProcedures,
  /** Without a Channel, the people a new Channel in this scope can start with. */
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
  /** In a project Channel, `joinProject` seats an Agent from outside in the project first. */
  addAgent: channelProcedure
    .input(z.object({ channelId, agent: agentSelection, joinProject: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.addAgent(input.channelId, input.agent, {
        joinProject: input.joinProject,
      }),
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
  /** Requests to run Channel Agents on the caller's private devices, for them to decide. */
  deviceGrants: channelProcedure.query(async ({ ctx }) => ({
    data: await ctx.channelService.deviceGrants(),
    success: true,
  })),
  /** Only the device owner named on the grant may decide it. */
  decideDeviceGrant: channelProcedure
    .input(z.object({ decision: z.enum(['approve', 'reject', 'revoke']), grantId: z.uuid() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.decideDeviceGrant(input.grantId, input.decision),
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
        joinProject: z.boolean().optional(),
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
  detail: externalChannelProcedure
    .input(
      z.object({
        before: z.number().int().positive().optional(),
        channelId,
        /**
         * The client renders the opt-in Work types (files, collections) on reply cards. Released
         * desktop clients without them omit it and keep receiving only the types they know.
         */
        includeFileWorks: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        threadId: threadId.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.detail(input.channelId, input),
      success: true,
    })),
  /**
   * Visitors' conversations with the caller's shared Agent, for its owner to read; empty unless
   * the share lets the owner read visitor conversations.
   */
  shareVisitors: channelProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.shareVisitors(input.agentId),
      success: true,
    })),
  /** A visitor's run topic with its transcript, read-only for the shared Agent's owner. */
  shareVisitorTopic: channelProcedure
    .input(z.object({ topicId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.shareVisitorTopic(input.topicId),
      success: true,
    })),
  /** The run topics of visitors' conversations with the caller's shared Agent, by visitor. */
  shareVisitorTopics: channelProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.shareVisitorTopics(input.agentId),
      success: true,
    })),
  /** Messages in a Channel and its Threads containing every word of `query`, newest first. */
  searchMessages: channelProcedure
    .input(
      z.object({
        before: z.number().int().positive().optional(),
        channelId,
        limit: z.number().int().min(1).max(50).optional(),
        query: z.string().trim().min(1).max(200),
      }),
    )
    .query(async ({ ctx, input: { channelId, ...options } }) => ({
      data: await ctx.channelService.repository.searchMessages(channelId, options),
      success: true,
    })),
  /**
   * The caller's direct conversation with an Agent, opened on first use for Agents that predate
   * direct Channels; a project's main Agent opens in its project's Channel instead. Null when the
   * Agent cannot answer in a Channel (no reachable device).
   */
  openDirect: channelProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ({
      data: (await ctx.channelService.openAgent(input.agentId)) ?? null,
      success: true,
    })),
  /** The direct conversation with another person's Agent, from its share id, handle or link. */
  openShared: channelProcedure
    .input(z.object({ share: z.string().trim().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const access = await ctx.channelService.openShared(input.share);
      return { data: access?.channel.id ?? null, success: true };
    }),
  /**
   * The one-on-one conversation with another person: a mutual contact in the personal space, a
   * fellow member in a workspace.
   */
  openPeer: externalChannelProcedure
    .input(z.object({ userId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const access = await ctx.channelService.openPeer(input.userId);
      return { data: access.channel.id, success: true };
    }),
  /** Public Channels in the active workspace the caller can join. */
  listJoinable: channelProcedure
    .input(z.object({ search: z.string().max(100).optional() }).optional())
    .query(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.listJoinable(input?.search),
    })),
  /** Joins an open project Channel or a public one the caller can join. */
  join: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    const { channel } = await ctx.channelService.join(input.channelId);
    return { data: channel, success: true };
  }),
  /** The caller leaves a group Channel; its owner cannot. */
  leave: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    const { readable } = await ctx.channelService.leave(input.channelId);
    return { readable, success: true };
  }),
  list: externalChannelProcedure.query(async ({ ctx }) => ({
    data: await ctx.channelService.repository.list(),
    success: true,
  })),
  markRead: externalChannelProcedure
    .input(z.object({ channelId, sequence: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.markRead(input.channelId, input.sequence),
      success: true,
    })),
  /**
   * Turns the caller's own push notifications for the conversation off or on. Personal: Agents
   * still reply (see `setMemberMuted` for that) and other members are untouched.
   */
  setNotificationsMuted: externalChannelProcedure
    .input(z.object({ channelId, muted: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.setNotificationsMuted(input.channelId, input.muted),
      success: true,
    })),
  /** Pins or unpins the conversation atop the caller's own list. */
  setPinned: externalChannelProcedure
    .input(z.object({ channelId, pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.setPinned(input.channelId, input.pinned),
      success: true,
    })),
  /** Files the conversation under one of the caller's own sections; null returns it to the built-in one. */
  moveToSection: externalChannelProcedure
    .input(z.object({ channelId, sectionId: sectionId.nullable() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.moveToSection(input.channelId, input.sectionId),
      success: true,
    })),
  /** Hides the conversation from the caller's own list until its next message, or shows it again. */
  setHidden: externalChannelProcedure
    .input(z.object({ channelId, hidden: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.setHidden(input.channelId, input.hidden),
      success: true,
    })),
  /** The caller's own sidebar sections in the current scope, in order. */
  listSections: externalChannelProcedure.query(async ({ ctx }) => ({
    data: await ctx.channelService.repository.sections.list(),
    success: true,
  })),
  createSection: externalChannelProcedure
    .input(z.object({ name: sectionName }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.sections.create(input.name),
      success: true,
    })),
  updateSection: externalChannelProcedure
    .input(
      z.object({
        id: sectionId,
        value: z.object({ collapsed: z.boolean().optional(), name: sectionName.optional() }),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.repository.sections.update(input.id, input.value),
      success: true,
    })),
  reorderSections: externalChannelProcedure
    .input(z.object({ ids: z.array(sectionId).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.repository.sections.reorder(input.ids);
      return { success: true };
    }),
  /** Deletes a section; its conversations return to the built-in sections. */
  removeSection: externalChannelProcedure
    .input(z.object({ id: sectionId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.repository.sections.remove(input.id);
      return { success: true };
    }),
  remove: channelProcedure.input(z.object({ channelId })).mutation(async ({ ctx, input }) => {
    await ctx.channelService.remove(input.channelId);
    return { success: true };
  }),
  setMemberMuted: channelProcedure
    .input(z.object({ channelId, memberId: z.uuid(), muted: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.setMemberMuted(input.channelId, input.memberId, input.muted);
      return { success: true };
    }),
  editMessage: externalChannelProcedure
    .input(
      z.object({
        channelId,
        content: z.string().max(CHANNEL_LIMITS.contentLength),
        messageId: z.uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.editMessage(input.channelId, input.messageId, input.content),
      success: true,
    })),
  deleteMessage: channelProcedure
    .input(z.object({ channelId, messageId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.deleteMessage(input.channelId, input.messageId);
      return { success: true };
    }),
  /** An admin removes a person or an Agent from a group Channel. */
  removeMember: channelProcedure
    .input(z.object({ channelId, memberId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.removeMember(input.channelId, input.memberId);
      return { success: true };
    }),
  rename: channelProcedure
    .input(z.object({ channelId, title: z.string().trim().min(1).max(CHANNEL_LIMITS.titleLength) }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.rename(input.channelId, input.title),
      success: true,
    })),
  updateVisibility: channelProcedure
    .input(z.object({ channelId, visibility: z.enum(['private', 'public']) }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.updateVisibility(input.channelId, input.visibility),
      success: true,
    })),
  removeThread: channelProcedure
    .input(z.object({ channelId, threadId }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.removeThread(input.channelId, input.threadId);
      return { success: true };
    }),
  /** Runs a failed reply again in the conversation it stopped in; see `retryJob` for a fresh start. */
  resumeJob: channelProcedure
    .input(z.object({ channelId, jobId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.resumeJob(input.channelId, input.jobId);
      return { success: true };
    }),
  retryJob: channelProcedure
    .input(z.object({ channelId, jobId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.channelService.retryJob(input.channelId, input.jobId);
      return { success: true };
    }),
  retryRouting: channelProcedure
    .input(z.object({ channelId, messageId: z.uuid() }))
    .mutation(async ({ ctx, input }) => ({
      data: await ctx.channelService.retryRouting(input.channelId, input.messageId),
      success: true,
    })),
  send: externalChannelProcedure
    .input(
      z.object({
        /** Share a contact as a card; the server writes the content and the card snapshot. */
        card: z
          .discriminatedUnion('type', [
            z.object({ type: z.literal('user'), userId: z.string().min(1) }),
            z.object({ agentId: z.string().min(1), type: z.literal('agent') }),
          ])
          .optional(),
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
