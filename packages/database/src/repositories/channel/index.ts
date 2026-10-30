import type { ChannelMemberConfig, ChannelMemberRole, ChannelVisibility } from '@lobechat/types';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import { TrashModel } from '../../models/trash';
import type { ChannelItem, ChannelJobItem, ChannelMessageItem } from '../../schemas';
import {
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
import { addChannelUser, channelUserCandidates } from './people';
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
export type { ChannelRoutingDecision } from './routing';
export type { ChannelSendInput } from './send';
export type { ChannelStopScope } from './stop';
export type { ChannelAccess, ChannelWriteOptions } from './types';

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
    agents?: ChannelAddAgentInput[];
    /** Callers check that the project is readable in this scope. */
    projectId?: string;
    title: string;
    visibility?: ChannelVisibility;
  }) =>
    this.db.transaction(async (tx) => {
      const { agentId } = params;
      if (
        agentId !== undefined &&
        (!agentId.trim() || params.visibility === 'public' || !!params.agents?.length)
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
      const [member] = await tx
        .insert(channelMembers)
        .values({
          actorType: 'user',
          channelId: channel.id,
          lastReadSequence: 0,
          role: 'owner',
          userId: this.userId,
        })
        .returning();

      if (agentId) await addAgentMember(tx, channel, this.userId, { agentId });
      for (const agent of params.agents ?? [])
        await addAgentMember(tx, channel, this.userId, agent);

      return { channel, member } satisfies ChannelAccess;
    });

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
        await requireAgentMember(tx, channelId, memberId);
        const [member] = await tx
          .update(channelMembers)
          .set({ config: memberEnvironment(config) })
          .where(eq(channelMembers.id, memberId))
          .returning();
        await audit(tx, channelId, 'member_environment_changed', memberId);
        return member;
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
        const view = await readChannelView(tx, channelId, options);
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
  list = async (): Promise<Array<ChannelItem & { canDelete: boolean }>> => {
    const rows = await this.db
      .select({ channel: channels, role: channelMembers.role })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(and(this.membershipWhere(), notTrashed(channels.isDeleted)))
      .orderBy(desc(channels.createdAt));

    return rows.map(({ channel, role }) => ({ ...channel, canDelete: hasRole(role, 'admin') }));
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

  private findDirect = async (
    tx: Transaction,
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
