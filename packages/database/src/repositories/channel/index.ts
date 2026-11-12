import type {
  ChannelMemberConfig,
  ChannelMemberRole,
  ChannelReplyJob,
  ChannelVisibility,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { TrashModel } from '../../models/trash';
import type { ChannelItem, ChannelJobItem, ChannelMessageItem } from '../../schemas';
import {
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed, trashStamp } from '../../utils/softDelete';
import { normalizeWorkspaceId } from '../../utils/workspace';
import type { ChannelAddAgentInput } from './agent';
import {
  addAgentMember,
  memberEnvironment,
  requireAgentMember,
  requireChannelAgent,
} from './agent';
import { findThread } from './delivery';
import { ChannelError } from './error';
import { addChannelUser, channelUserCandidates, newChannelUserCandidates } from './people';
import type { ChannelAgentPostInput } from './post';
import { postAgentMessage } from './post';
import { retryRouting } from './routing';
import type { ChannelSendInput } from './send';
import { sendMessage } from './send';
import type { ChannelStopScope } from './stop';
import { stopScope } from './stop';
import { audit, lockChannel } from './transaction';
import type { ChannelAccess, ChannelWriteOptions } from './types';
import { createChannelThread, readChannelView } from './view';

export type { ChannelAddAgentInput } from './agent';
export {
  CHANNEL_ROUTING_BATCH_SIZE,
  CHANNEL_ROUTING_LEASE_MS,
  ChannelRoutingRepository,
} from './ChannelRoutingRepository';
export type { ChannelClaim, ChannelClaimOptions } from './claim';
export type { ChannelErrorCode } from './error';
export { ChannelError } from './error';
export { ChannelExecutionRepository } from './execution';
export { ChannelHistoryRepository } from './history';
export type { ChannelAgentPostInput } from './post';
export type { AppliedChannelRouting, ChannelRoutingDecision } from './routing';
export type { ChannelSendInput } from './send';
export type { ChannelStopScope } from './stop';
export type { ChannelAccess, ChannelWriteOptions } from './types';
export type { ChannelWorktreeCandidate } from './worktree';

/** Recycle-bin row title: the start of the thread's root message. */
const CHANNEL_THREAD_TITLE_LENGTH = 120;

const ROLE_RANK: Record<ChannelMemberRole, number> = { admin: 1, member: 0, owner: 2 };

const hasRole = (role: ChannelMemberRole | null, minRole: ChannelMemberRole) =>
  ROLE_RANK[role ?? 'member'] >= ROLE_RANK[minRole];

/**
 * Membership-scoped access to channels.
 *
 * A caller reaches a channel only through its own active human member row, in the current
 * scope (personal, or the given workspace). Every write runs inside `write`, which holds the
 * `channels` row lock so mutations of one channel serialize in a transaction.
 */
/** Characters of the latest message a Channel list item carries as its preview. */
const LIST_PREVIEW_LENGTH = 200;

/** A member config with its reply strategy set, or without one when `wake` is empty. */
const withMemberWake = (
  config: ChannelMemberConfig,
  wake: Record<string, unknown> | null | undefined,
): ChannelMemberConfig => (wake ? { ...config, wake } : config);

export class ChannelRepository {
  private readonly workspaceId: string | null;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string | null,
  ) {
    this.workspaceId = normalizeWorkspaceId(workspaceId);
  }

  /** Opens the unique direct conversation, or creates a group with its initial members. */
  create = async (params: {
    agentId?: string;
    /** The direct conversation's Agent environment; the caller resolved and checked it. */
    agentConfig?: ChannelMemberConfig;
    agents?: ChannelAddAgentInput[];
    /** Callers check that the project is readable in this scope. */
    projectId?: string;
    title: string;
    /** Workspace people a group starts with, checked the same way as adding them later. */
    userIds?: string[];
    visibility?: ChannelVisibility;
  }) =>
    this.db.transaction(async (tx) => {
      const { agentId } = params;
      if (
        agentId !== undefined &&
        (!agentId.trim() ||
          params.visibility === 'public' ||
          !!params.agents?.length ||
          !!params.userIds?.length)
      )
        throw new ChannelError(
          'BAD_REQUEST',
          'A direct conversation requires an Agent and private visibility',
        );
      if (agentId) {
        await requireChannelAgent(tx, this.workspaceId, this.userId, agentId);
        const existing = await this.findDirect(tx, agentId);
        if (existing) return existing;
      }
      const insert = tx.insert(channels).values({
        agentId,
        projectId: params.projectId,
        userId: this.userId,
        title: params.title,
        visibility: params.visibility,
        workspaceId: this.workspaceId,
      });
      // A concurrent open of the same direct conversation wins the unique index; reuse its row.
      const [channel] = agentId
        ? await insert.onConflictDoNothing().returning()
        : await insert.returning();
      if (!channel) {
        const existing = agentId ? await this.findDirect(tx, agentId) : undefined;
        if (existing) return existing;
        throw new ChannelError('CONFLICT', 'The direct conversation is unavailable');
      }
      const member = await this.addOwner(tx, channel.id);

      if (agentId)
        await addAgentMember(tx, channel, this.userId, { agentId, config: params.agentConfig });
      for (const agent of params.agents ?? [])
        await addAgentMember(tx, channel, this.userId, agent);
      const access = { channel, member } satisfies ChannelAccess;
      for (const userId of new Set(params.userIds)) await addChannelUser(tx, access, userId);

      return access;
    });

  /**
   * Inviting into a direct conversation starts a group instead, and the direct conversation stays
   * as it is. The group holds its person and Agent, the Agent keeping its channel-local
   * environment, joined by the invited Agents and workspace people.
   */
  createGroupFromDirect = async (
    channelId: string,
    params: { agents?: ChannelAddAgentInput[]; title: string; userIds?: string[] },
  ) =>
    this.write(
      channelId,
      async (tx, { channel: direct }) => {
        if (!direct.agentId)
          throw new ChannelError('BAD_REQUEST', 'Only a direct conversation starts a group');
        if (!params.agents?.length && !params.userIds?.length)
          throw new ChannelError('BAD_REQUEST', 'Invite at least one person or Agent');
        const [bound] = await tx
          .select()
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, direct.id),
              eq(channelMembers.agentId, direct.agentId),
              eq(channelMembers.status, 'active'),
            ),
          )
          .limit(1);
        if (!bound) throw new ChannelError('NOT_FOUND', 'Agent member not found');

        const [channel] = await tx
          .insert(channels)
          .values({ title: params.title, userId: this.userId, workspaceId: this.workspaceId })
          .returning();
        const member = await this.addOwner(tx, channel.id);
        const access = { channel, member } satisfies ChannelAccess;
        await addAgentMember(tx, channel, this.userId, {
          agentId: direct.agentId,
          config: bound.config ?? undefined,
          description: bound.description,
          name: bound.name ?? undefined,
        });
        for (const agent of params.agents ?? [])
          await addAgentMember(tx, channel, this.userId, agent);
        for (const userId of new Set(params.userIds)) await addChannelUser(tx, access, userId);
        return access;
      },
      { minRole: 'admin' },
    );

  /** Adds a usable Agent reference; a missing reference is allowed only for retained history. */
  addAgent = async (channelId: string, input: ChannelAddAgentInput) =>
    this.write(channelId, (tx, { channel }) => addAgentMember(tx, channel, this.userId, input), {
      minRole: 'admin',
    });

  /** The channel-local device and directory of one Agent member. */
  agentEnvironment = async (channelId: string, memberId: string) =>
    this.write(
      channelId,
      async (tx) => {
        const member = await requireAgentMember(tx, channelId, memberId);
        // The device owner is routing data, not something the editor chooses.
        const { deviceId, workingDirectory } = memberEnvironment(member.config);
        return { agentId: member.agentId, deviceId, workingDirectory };
      },
      { minRole: 'admin' },
    );

  /**
   * Replaces one Agent member's channel-local environment. Claimed jobs keep the
   * environment frozen in their execution config; later claims use the new one.
   */
  updateAgentEnvironment = async (
    channelId: string,
    memberId: string,
    config: ChannelMemberConfig,
  ) =>
    this.write(
      channelId,
      async (tx) => {
        const current = await requireAgentMember(tx, channelId, memberId);
        const [member] = await tx
          .update(channelMembers)
          // The environment is replaced; the member's reply strategy is not part of it.
          .set({ config: withMemberWake(memberEnvironment(config), current.config?.wake) })
          .where(eq(channelMembers.id, memberId))
          .returning();
        await audit(tx, channelId, 'member_environment_changed', memberId);
        return member;
      },
      { minRole: 'admin' },
    );

  /**
   * The channel's reply strategy and each active Agent member's own, as stored (not parsed):
   * `null` means the defaults apply. Validation belongs to the shared wake schema in the caller.
   */
  wakeConfig = async (channelId: string) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const members = await tx
          .select({ config: channelMembers.config, id: channelMembers.id })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channelId),
              eq(channelMembers.actorType, 'agent'),
              eq(channelMembers.status, 'active'),
            ),
          );
        return {
          channel: channel.config?.wake ?? null,
          members: members.map((member) => ({
            memberId: member.id,
            wake: member.config?.wake ?? null,
          })),
        };
      },
      { minRole: 'admin' },
    );

  /**
   * Whose records one Agent member's wake decisions are filed under: its Agent's owner, in the
   * channel's workspace. `null` when the Agent has no owner left to file them under.
   */
  memberWakeRecordScope = async (channelId: string, memberId: string) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const member = await requireAgentMember(tx, channelId, memberId);
        const [agent] = await tx
          .select({ userId: agents.userId })
          .from(agents)
          .where(eq(agents.id, member.agentId));
        return agent?.userId ? { userId: agent.userId, workspaceId: channel.workspaceId } : null;
      },
      { minRole: 'admin' },
    );

  /** Replaces the channel's reply strategy; `null` returns it to the defaults. */
  updateChannelWakeConfig = async (channelId: string, wake: Record<string, unknown> | null) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const { wake: _previous, ...rest } = channel.config ?? {};
        const config = wake ? { ...rest, wake } : rest;
        const [updated] = await tx
          .update(channels)
          .set({ config: Object.keys(config).length ? config : null })
          .where(eq(channels.id, channelId))
          .returning();
        await audit(tx, channelId, 'wake_config_changed', channelId, { reset: !wake });
        return updated.config?.wake ?? null;
      },
      { minRole: 'admin' },
    );

  /**
   * Replaces one Agent member's own reply strategy over the channel's; `null` removes it. Its
   * environment is kept as it is.
   */
  updateMemberWakeConfig = async (
    channelId: string,
    memberId: string,
    wake: Record<string, unknown> | null,
  ) =>
    this.write(
      channelId,
      async (tx) => {
        const current = await requireAgentMember(tx, channelId, memberId);
        const [member] = await tx
          .update(channelMembers)
          .set({ config: withMemberWake(memberEnvironment(current.config), wake) })
          .where(eq(channelMembers.id, memberId))
          .returning();
        await audit(tx, channelId, 'member_wake_config_changed', memberId, { reset: !wake });
        return member.config?.wake ?? null;
      },
      { minRole: 'admin' },
    );

  rename = async (channelId: string, title: string) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const next = title.trim();
        if (!next) throw new ChannelError('BAD_REQUEST', 'A channel name is required');
        if (next === channel.title) return channel;
        const [renamed] = await tx
          .update(channels)
          .set({ title: next })
          .where(eq(channels.id, channelId))
          .returning();
        await audit(tx, channelId, 'renamed', channelId);
        return renamed;
      },
      { minRole: 'admin' },
    );

  addUser = async (channelId: string, userId: string) =>
    this.write(channelId, (tx, access) => addChannelUser(tx, access, userId), { minRole: 'admin' });

  /** People a new Channel in this workspace can start with. */
  newChannelUserCandidates = async (search?: string) => {
    const { workspaceId } = this;
    if (!workspaceId)
      throw new ChannelError('BAD_REQUEST', 'People can only be added to workspace group channels');
    return this.db.transaction((tx) =>
      newChannelUserCandidates(tx, workspaceId, this.userId, search),
    );
  };

  userCandidates = async (channelId: string, search?: string) =>
    this.write(channelId, (tx, access) => channelUserCandidates(tx, access, search), {
      minRole: 'admin',
    });

  detail = async (channelId: string, options?: Parameters<typeof readChannelView>[2]) =>
    this.write(
      channelId,
      async (tx, access) => {
        if (access.channel.isDeleted) throw new ChannelError('NOT_FOUND', 'Channel not found');
        const admin = hasRole(access.member.role, 'admin');
        const view = await readChannelView(tx, channelId, options, this.userId);
        return {
          channel: { ...access.channel, canDelete: admin },
          ...view,
          // Mirrors `stop`: the requester or an admin.
          jobs: view.jobs.map(({ requesterMemberId, ...job }) => ({
            ...job,
            canStop: admin || requesterMemberId === access.member.id,
          })),
        };
      },
      { allowArchived: true, allowTrashed: true },
    );

  createThread = async (channelId: string, input: Parameters<typeof createChannelThread>[2]) =>
    this.write(channelId, (tx) => createChannelThread(tx, channelId, input));

  markRead = async (channelId: string, sequence: number) =>
    this.write(
      channelId,
      async (tx, { channel, member }) => {
        const lastReadSequence = Math.max(
          member.lastReadSequence ?? 0,
          Math.min(sequence, channel.sequence),
        );
        await tx
          .update(channelMembers)
          .set({ lastReadSequence })
          .where(eq(channelMembers.id, member.id));
        return lastReadSequence;
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Channels the caller belongs to in the current scope, newest first. Archived ones are
   * included with their `status`, so they stay readable outside the active list.
   */
  list = async (): Promise<
    Array<
      ChannelItem & {
        canDelete: boolean;
        lastMessage: { content: string; createdAt: Date } | null;
        mentionCount: number;
        replyJobs: ChannelReplyJob[];
        unreadCount: number;
      }
    >
  > => {
    const rows = await this.db
      .select({
        channel: channels,
        lastReadSequence: channelMembers.lastReadSequence,
        memberId: channelMembers.id,
        role: channelMembers.role,
      })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(and(this.membershipWhere(), notTrashed(channels.isDeleted)))
      .orderBy(desc(channels.createdAt));

    // The newest main-channel message of each, for a conversation-list preview.
    const latest = rows.length
      ? await this.db
          .selectDistinctOn([channelMessages.channelId], {
            channelId: channelMessages.channelId,
            content: sql<string>`left(${channelMessages.content}, ${LIST_PREVIEW_LENGTH})`,
            createdAt: channelMessages.createdAt,
          })
          .from(channelMessages)
          .where(
            and(
              inArray(
                channelMessages.channelId,
                rows.map(({ channel }) => channel.id),
              ),
              isNull(channelMessages.threadId),
            ),
          )
          .orderBy(channelMessages.channelId, desc(channelMessages.sequence))
      : [];
    const lastMessageOf = new Map(
      latest.map(({ channelId, ...message }) => [channelId, message] as const),
    );

    // Main-conversation replies the list row shows as in progress: ones that can still publish,
    // and stopped ones whose writer has not exited yet.
    const pending = rows.length
      ? await this.db
          .select({
            blockedCode: channelJobs.blockedCode,
            channelId: channelJobs.channelId,
            id: channelJobs.id,
            memberId: channelJobs.memberId,
            publicationRevoked: channelJobs.publicationRevoked,
            status: channelJobs.status,
            threadId: channelJobs.threadId,
            writerHeld: channelJobs.writerHeld,
          })
          .from(channelJobs)
          .where(
            and(
              inArray(
                channelJobs.channelId,
                rows.map(({ channel }) => channel.id),
              ),
              isNull(channelJobs.threadId),
              or(
                and(
                  eq(channelJobs.publicationRevoked, false),
                  inArray(channelJobs.status, ['queued', 'running']),
                ),
                and(eq(channelJobs.publicationRevoked, true), eq(channelJobs.writerHeld, true)),
              ),
            ),
          )
          .orderBy(desc(channelJobs.createdAt))
      : [];
    const replyJobsOf = new Map<string, ChannelReplyJob[]>();
    for (const { channelId, ...job } of pending) {
      const jobs = replyJobsOf.get(channelId) ?? [];
      jobs.push(job);
      replyJobsOf.set(channelId, jobs);
    }

    // Unread messages that @mention the caller, counted from the same read position as
    // `unreadCount`; only channels with unread messages are scanned.
    const unreadMemberIds = rows
      .filter(({ channel, lastReadSequence }) => channel.sequence > (lastReadSequence ?? 0))
      .map(({ memberId }) => memberId);
    const mentioned = unreadMemberIds.length
      ? await this.db
          .select({
            channelId: channelMessages.channelId,
            count: sql<number>`count(*)::int`,
          })
          .from(channelMessages)
          .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
          .where(
            and(
              inArray(channelMembers.id, unreadMemberIds),
              sql`${channelMessages.sequence} > coalesce(${channelMembers.lastReadSequence}, 0)`,
              sql`${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)`,
            ),
          )
          .groupBy(channelMessages.channelId)
      : [];
    const mentionCountOf = new Map(mentioned.map(({ channelId, count }) => [channelId, count]));

    return rows.map(({ channel, lastReadSequence, role }) => ({
      ...channel,
      canDelete: hasRole(role, 'admin'),
      lastMessage: lastMessageOf.get(channel.id) ?? null,
      mentionCount: mentionCountOf.get(channel.id) ?? 0,
      replyJobs: replyJobsOf.get(channel.id) ?? [],
      unreadCount: Math.max(0, channel.sequence - (lastReadSequence ?? 0)),
    }));
  };

  /** Read access. Returns undefined when the channel is missing or the caller is no member. */
  findAccess = async (channelId: string): Promise<ChannelAccess | undefined> => {
    const [row] = await this.db
      .select({ channel: channels, member: channelMembers })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(and(eq(channels.id, channelId), this.membershipWhere()))
      .limit(1);

    return row;
  };

  /** The caller's direct conversation with an Agent in this scope, trashed or not. */
  findDirectAccess = (agentId: string): Promise<ChannelAccess | undefined> =>
    this.findDirect(this.db, agentId);

  /**
   * Runs `fn` while holding the channel row lock, after checking that the caller is an
   * active member with at least `minRole` (default `member`).
   */
  write = async <T>(
    channelId: string,
    fn: (tx: Transaction, access: ChannelAccess) => Promise<T>,
    options: ChannelWriteOptions = {},
  ): Promise<T> =>
    this.db.transaction(async (tx) => {
      await lockChannel(tx, channelId);

      // Read membership only after the lock: a removal or demotion committed by the previous
      // lock holder must be visible here, not the snapshot from before the wait.
      const [access] = await tx
        .select({ channel: channels, member: channelMembers })
        .from(channels)
        .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
        .where(and(eq(channels.id, channelId), this.membershipWhere()))
        .limit(1);
      if (!access) throw new ChannelError('NOT_FOUND', 'Channel not found');

      const minRole = options.minRole ?? 'member';
      if (!hasRole(access.member.role, minRole))
        throw new ChannelError('FORBIDDEN', `Requires the ${minRole} role in this channel`);
      if (access.channel.isDeleted && !options.allowTrashed)
        throw new ChannelError('CONFLICT', 'Channel is in the trash');
      if (access.channel.status === 'archived' && !options.allowArchived)
        throw new ChannelError('CONFLICT', 'Channel is archived');

      return fn(tx, access);
    });

  /**
   * Posts what an Agent member wrote outside any job into a Channel the caller belongs to.
   * See {@link postAgentMessage}.
   */
  postAgentMessage = async (
    channelId: string,
    input: ChannelAgentPostInput,
  ): Promise<ChannelMessageItem> =>
    this.write(channelId, (tx) => postAgentMessage(tx, channelId, input));

  /** Posts a message as the caller. See {@link sendMessage} for routing. */
  send = async (channelId: string, input: ChannelSendInput): Promise<ChannelMessageItem> =>
    this.write(channelId, (tx, access) => sendMessage(tx, access, input));

  /**
   * Stops one job (its requester or an admin) or a branch: everything for admins, only the
   * caller's own requests for members. Returns the jobs whose writer is still held; the
   * caller must stop them physically.
   */
  stop = async (channelId: string, scope: ChannelStopScope): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { member }) => {
        const admin = hasRole(member.role, 'admin');
        if ('jobId' in scope && !admin) {
          const [job] = await tx
            .select({ requesterMemberId: channelJobs.requesterMemberId })
            .from(channelJobs)
            .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, scope.jobId)));
          if (job && job.requesterMemberId !== member.id)
            throw new ChannelError('FORBIDDEN', 'Only the requester or an admin can stop this job');
        }
        return stopScope(
          tx,
          channelId,
          scope,
          'threadId' in scope && !admin ? { memberId: member.id, userId: this.userId } : undefined,
        );
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Archive: keep the channel for good, readable but closed to messages and Agent work. Stops
   * everything in it like a deletion and keeps receipts until the coordinator confirms exit.
   */
  archive = async (channelId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const writers = await stopScope(tx, channelId, { all: true });
        if (channel.status !== 'archived') {
          await tx.update(channels).set({ status: 'archived' }).where(eq(channels.id, channelId));
          await audit(tx, channelId, 'archived', channelId);
        }
        return writers;
      },
      { allowArchived: true, minRole: 'admin' },
    );

  /** Reopens an archived channel. Work stopped by the archive stays stopped. */
  unarchive = async (channelId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        if (channel.status === 'active') return;
        await tx.update(channels).set({ status: 'active' }).where(eq(channels.id, channelId));
        await audit(tx, channelId, 'unarchived', channelId);
      },
      { allowArchived: true, minRole: 'admin' },
    );

  /** Archive a branch: its history stays readable, but it takes no replies and leaves Agent context. */
  archiveThread = async (channelId: string, threadId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx) => {
        const thread = await findThread(tx, channelId, threadId);
        const writers = await stopScope(tx, channelId, { threadId });
        if (thread?.status !== 'archived') {
          await tx
            .update(channelThreads)
            .set({ status: 'archived' })
            .where(eq(channelThreads.id, threadId));
          await audit(tx, channelId, 'thread_archived', threadId);
        }
        return writers;
      },
      { minRole: 'admin' },
    );

  unarchiveThread = async (channelId: string, threadId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx) => {
        const thread = await findThread(tx, channelId, threadId);
        if (thread?.status === 'active') return;
        await tx
          .update(channelThreads)
          .set({ status: 'active' })
          .where(eq(channelThreads.id, threadId));
        await audit(tx, channelId, 'thread_unarchived', threadId);
      },
      { minRole: 'admin' },
    );

  /** Soft-delete under the same lock as dispatch/publication; retain receipts until exit. */
  remove = async (channelId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const writers = await stopScope(tx, channelId, { all: true });
        if (!channel.isDeleted) {
          const deletedAt = new Date();
          await tx.update(channels).set(trashStamp(deletedAt)).where(eq(channels.id, channelId));
          await new TrashModel(this.db, this.userId, this.workspaceId ?? undefined).register(
            {
              deletedAt,
              root: {
                projectId: channel.projectId,
                resourceId: channel.id,
                resourceType: 'channel',
                title: channel.title,
              },
            },
            tx,
          );
          await audit(tx, channelId, 'trashed', channelId);
        }
        return writers;
      },
      { allowArchived: true, allowTrashed: true, minRole: 'admin' },
    );

  /**
   * Move a branch to the recycle bin. Its messages and job receipts stay intact for restore;
   * the thread is registered as its own root, like a message under a topic.
   */
  removeThread = async (channelId: string, threadId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const [row] = await tx
          .select({ root: channelMessages.content, thread: channelThreads })
          .from(channelThreads)
          .innerJoin(
            channelMessages,
            and(
              eq(channelMessages.channelId, channelThreads.channelId),
              eq(channelMessages.id, channelThreads.rootMessageId),
            ),
          )
          .where(and(eq(channelThreads.channelId, channelId), eq(channelThreads.id, threadId)));
        if (!row) throw new ChannelError('NOT_FOUND', 'Thread not found');
        // A retry after a scheduling failure must still be authorized, but must not
        // repeat the stamp or release a writer before the coordinator confirms exit.
        if (row.thread.isDeleted) return;
        await stopScope(tx, channelId, { threadId });
        const deletedAt = new Date();
        await tx
          .update(channelThreads)
          .set(trashStamp(deletedAt))
          .where(eq(channelThreads.id, threadId));
        await new TrashModel(this.db, this.userId, this.workspaceId ?? undefined).register(
          {
            deletedAt,
            root: {
              meta: { parentTitle: channel.title },
              projectId: channel.projectId,
              resourceId: threadId,
              resourceType: 'channelThread',
              title: row.root.trim().slice(0, CHANNEL_THREAD_TITLE_LENGTH) || null,
            },
          },
          tx,
        );
        await audit(tx, channelId, 'thread_trashed', threadId);
      },
      { minRole: 'admin' },
    );

  /** Sends an unassigned message back to the decision model. Its author or an admin may retry. */
  retryRouting = async (channelId: string, messageId: string): Promise<ChannelMessageItem> =>
    this.write(channelId, async (tx, { member }) => {
      if (!hasRole(member.role, 'admin')) {
        const [message] = await tx
          .select({ userId: channelMessages.userId })
          .from(channelMessages)
          .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
        if (message && message.userId !== member.userId)
          throw new ChannelError('FORBIDDEN', 'Only the author or an admin can retry routing');
      }
      return retryRouting(tx, channelId, messageId);
    });

  private addOwner = async (tx: Transaction, channelId: string) => {
    const [member] = await tx
      .insert(channelMembers)
      .values({
        actorType: 'user',
        channelId,
        lastReadSequence: 0,
        role: 'owner',
        userId: this.userId,
      })
      .returning();
    return member;
  };

  private findDirect = async (
    tx: LobeChatDatabase | Transaction,
    agentId: string,
  ): Promise<ChannelAccess | undefined> => {
    const [row] = await tx
      .select({ channel: channels, member: channelMembers })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.userId, this.userId),
          this.membershipWhere(),
        ),
      )
      .limit(1);
    return row;
  };

  private membershipWhere() {
    return and(
      eq(channelMembers.actorType, 'user'),
      eq(channelMembers.userId, this.userId),
      eq(channelMembers.status, 'active'),
      or(isNull(channels.agentId), eq(channels.userId, this.userId)),
      this.workspaceId ? eq(channels.workspaceId, this.workspaceId) : isNull(channels.workspaceId),
    );
  }
}
