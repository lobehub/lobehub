import { and, eq, inArray } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelJobs, channelMembers, channels } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { ChannelError } from './error';
import { stopScope } from './stop';
import { audit, lockChannel } from './transaction';
import type { ChannelAccess } from './types';
import { OPEN_JOB_STATUSES } from './writer';

/** A direct or person-to-person conversation is defined by its two sides, so no one leaves it. */
const requireGroup = ({ channel }: ChannelAccess) => {
  if (channel.agentId || channel.peerUserId)
    throw new ChannelError('BAD_REQUEST', 'A direct conversation keeps its members');
};

/** Cancels an Agent member's open jobs; returns the writers the caller must still stop. */
const stopMemberJobs = async (tx: Transaction, channelId: string, memberId: string) => {
  const open = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.memberId, memberId),
        inArray(channelJobs.status, [...OPEN_JOB_STATUSES]),
      ),
    );
  const writers: ChannelJobItem[] = [];
  for (const { id } of open) writers.push(...(await stopScope(tx, channelId, { jobId: id })));
  return writers;
};

/**
 * Removes a person or an Agent from a group Channel, under the lock after the caller's admin
 * role was checked. The owner stays, and only the owner removes another admin. A removed person
 * does not come back through an open project Channel; an admin can add them again.
 */
export const removeChannelMember = async (
  tx: Transaction,
  access: ChannelAccess,
  memberId: string,
): Promise<ChannelJobItem[]> => {
  requireGroup(access);
  const [target] = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, access.channel.id),
        eq(channelMembers.id, memberId),
        eq(channelMembers.status, 'active'),
      ),
    );
  if (!target) throw new ChannelError('NOT_FOUND', 'Member not found');
  if (target.id === access.member.id)
    throw new ChannelError('BAD_REQUEST', 'Leave the Channel instead of removing yourself');
  if (target.role === 'owner') throw new ChannelError('FORBIDDEN', 'The owner cannot be removed');
  if (target.role === 'admin' && access.member.role !== 'owner')
    throw new ChannelError('FORBIDDEN', 'Only the owner can remove an admin');

  const writers =
    target.actorType === 'agent' ? await stopMemberJobs(tx, access.channel.id, target.id) : [];
  await tx
    .update(channelMembers)
    .set({ status: 'removed' })
    .where(eq(channelMembers.id, target.id));
  await audit(tx, access.channel.id, 'member_removed', target.id, {
    actorType: target.actorType,
    ...(target.agentId ? { agentId: target.agentId } : { userId: target.userId }),
  });
  return writers;
};

/**
 * The caller leaves a group Channel. The owner hands the Channel on by deleting it, so they stay.
 * Someone who left an open project Channel can join it again.
 */
export const leaveChannel = async (tx: Transaction, access: ChannelAccess): Promise<void> => {
  requireGroup(access);
  if (access.member.role === 'owner')
    throw new ChannelError('CONFLICT', 'The owner cannot leave the Channel');
  await tx
    .update(channelMembers)
    .set({ status: 'left' })
    .where(eq(channelMembers.id, access.member.id));
  await audit(tx, access.channel.id, 'member_left', access.member.id, {
    actorType: 'user',
    userId: access.member.userId,
  });
};

/**
 * An Agent that leaves a project leaves its Channels too: a project Channel only seats the
 * project's own Agents. Called by project member management after its own permission check.
 * Returns the Channels it left and the writers still to stop.
 */
export const removeAgentFromProjectChannels = (
  db: LobeChatDatabase,
  projectId: string,
  agentId: string,
): Promise<{ channelIds: string[]; writers: ChannelJobItem[] }> =>
  db.transaction(async (tx) => {
    const seats = await tx
      .select({ channelId: channelMembers.channelId, id: channelMembers.id })
      .from(channelMembers)
      .innerJoin(channels, eq(channels.id, channelMembers.channelId))
      .where(
        and(
          eq(channels.projectId, projectId),
          eq(channelMembers.actorType, 'agent'),
          eq(channelMembers.agentId, agentId),
          eq(channelMembers.status, 'active'),
        ),
      );
    const writers: ChannelJobItem[] = [];
    for (const seat of seats) {
      // The same lock every Channel write holds, so a reply cannot claim the seat meanwhile.
      await lockChannel(tx, seat.channelId);
      writers.push(...(await stopMemberJobs(tx, seat.channelId, seat.id)));
      await tx
        .update(channelMembers)
        .set({ status: 'removed' })
        .where(eq(channelMembers.id, seat.id));
      await audit(tx, seat.channelId, 'member_removed', seat.id, {
        actorType: 'agent',
        agentId,
        reason: 'left_project',
      });
    }
    return { channelIds: [...new Set(seats.map(({ channelId }) => channelId))], writers };
  });
