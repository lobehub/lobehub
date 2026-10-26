import type { ChannelMemberRole, ChannelVisibility } from '@lobechat/types';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

import type { ChannelItem, ChannelJobItem, ChannelMessageItem } from '../../schemas';
import { channelJobs, channelMembers, channelMessages, channels } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { normalizeWorkspaceId } from '../../utils/workspace';
import type { ChannelAddAgentInput } from './agent';
import { addAgentMember, requireChannelAgent } from './agent';
import { ChannelError } from './error';
import { retryRouting } from './routing';
import type { ChannelSendInput } from './send';
import { sendMessage } from './send';
import type { ChannelStopScope } from './stop';
import { stopScope } from './stop';
import { lockChannel } from './transaction';
import type { ChannelAccess, ChannelWriteOptions } from './types';
import { createChannelThread, readChannelView } from './view';

export type { ChannelAddAgentInput } from './agent';
export type { ChannelClaim, ChannelClaimOptions } from './claim';
export type { ChannelErrorCode } from './error';
export { ChannelError } from './error';
export { ChannelExecutionRepository } from './execution';
export type { ChannelRoutingDecision } from './routing';
export type { ChannelSendInput } from './send';
export type { ChannelStopScope } from './stop';
export type { ChannelAccess, ChannelWriteOptions } from './types';

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

  detail = async (channelId: string, options?: Parameters<typeof readChannelView>[2]) =>
    this.write(
      channelId,
      async (tx, access) => ({
        channel: access.channel,
        ...(await readChannelView(tx, channelId, options)),
      }),
      { allowArchived: true },
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
      { allowArchived: true },
    );

  /** Active channels the caller belongs to in the current scope, newest first. */
  list = async (): Promise<ChannelItem[]> => {
    const rows = await this.db
      .select({ channel: channels })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(and(this.membershipWhere(), eq(channels.archived, false)))
      .orderBy(desc(channels.createdAt));

    return rows.map((row) => row.channel);
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
      if (access.channel.archived && !options.allowArchived)
        throw new ChannelError('CONFLICT', 'Channel is archived');

      return fn(tx, access);
    });

  /** Posts a message as the caller. See {@link sendMessage} for routing. */
  send = async (channelId: string, input: ChannelSendInput): Promise<ChannelMessageItem> =>
    this.write(channelId, (tx, access) => sendMessage(tx, access, input));

  /**
   * Stops one job (its requester or an admin) or a whole branch (admins). Returns the jobs
   * whose writer is still held; the caller must stop them physically.
   */
  stop = async (channelId: string, scope: ChannelStopScope): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { member }) => {
        if ('jobId' in scope && !hasRole(member.role, 'admin')) {
          const [job] = await tx
            .select({ requesterMemberId: channelJobs.requesterMemberId })
            .from(channelJobs)
            .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, scope.jobId)));
          if (job && job.requesterMemberId !== member.id)
            throw new ChannelError('FORBIDDEN', 'Only the requester or an admin can stop this job');
        }
        return stopScope(tx, channelId, scope);
      },
      { allowArchived: true, minRole: 'threadId' in scope ? 'admin' : 'member' },
    );

  /** Sends an unassigned message back to Jev. Its author or an admin may retry. */
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
      eq(channelMembers.active, true),
      or(isNull(channels.agentId), eq(channels.userId, this.userId)),
      this.workspaceId ? eq(channels.workspaceId, this.workspaceId) : isNull(channels.workspaceId),
    );
  }
}
