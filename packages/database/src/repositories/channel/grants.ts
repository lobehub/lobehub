import type { ChannelMemberGrantStatus } from '@lobechat/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';
import { channelMemberGrants, channelMembers, channels, devices, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { ChannelError } from './error';
import { audit, lockChannel } from './transaction';

/**
 * Whether a member's Channel device needs its owner's approval, by the rule `deviceBlock` applies:
 * in a workspace Channel, any device not shared with the workspace. A personal Channel runs only
 * on its owner's own devices and has no grants.
 */
const needsGrant = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'workspaceId'>,
  deviceId: string,
) => {
  if (!channel.workspaceId) return false;
  const [shared] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.deviceId, deviceId),
        eq(devices.workspaceId, channel.workspaceId),
        eq(devices.visibility, 'public'),
      ),
    )
    .limit(1);
  return !shared;
};

/**
 * Keeps a member's grant in step with the environment just written to it, inside the same
 * channel lock. A private device gets a grant for exactly its device, owner and directory: approved
 * at once when the device owner picked it themselves, else pending until they decide. The same
 * environment saved again keeps its grant and decision; any other environment replaces it with a
 * fresh grant, so neither the approval nor the request ID carries over to somewhere else.
 */
export const syncMemberGrant = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'id' | 'workspaceId'>,
  member: Pick<ChannelMemberItem, 'config' | 'id'>,
  requester: Pick<ChannelMemberItem, 'id' | 'userId'>,
) => {
  const { deviceId, deviceOwnerId, workingDirectory } = member.config ?? {};
  const required = !!deviceId && (await needsGrant(tx, channel, deviceId));
  const [current] = await tx
    .select()
    .from(channelMemberGrants)
    .where(eq(channelMemberGrants.memberId, member.id));

  if (!required || !deviceId || !deviceOwnerId || !workingDirectory) {
    if (current) await tx.delete(channelMemberGrants).where(eq(channelMemberGrants.id, current.id));
    return;
  }
  if (
    current &&
    current.deviceId === deviceId &&
    current.deviceOwnerId === deviceOwnerId &&
    current.workingDirectory === workingDirectory
  )
    return current;

  // The grant is the device owner's answer to one environment, and the ID is what they answer
  // about. Replacing the row instead of updating it in place keeps that true: a request the owner
  // was looking at cannot be approved into effect for a directory or device that arrived after
  // they saw it, because the old ID no longer exists.
  if (current) await tx.delete(channelMemberGrants).where(eq(channelMemberGrants.id, current.id));

  const approved = requester.userId === deviceOwnerId;
  const now = new Date();
  const [grant] = await tx
    .insert(channelMemberGrants)
    .values({
      channelId: channel.id,
      decidedAt: approved ? now : null,
      deviceId,
      deviceOwnerId,
      memberId: member.id,
      requestedByMemberId: requester.id,
      revokeReason: null,
      revokedAt: null,
      status: (approved ? 'approved' : 'pending') as ChannelMemberGrantStatus,
      workingDirectory,
    })
    .returning();
  await audit(tx, channel.id, approved ? 'grant_approved' : 'grant_requested', grant.id);
  return grant;
};

/**
 * A pending request for a member whose device became private after it was picked: the claim found
 * no grant, so the device owner is asked on behalf of the person whose reply is waiting.
 */
export const requestMissingGrant = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'id'>,
  member: Pick<ChannelMemberItem, 'config' | 'id'>,
  requesterMemberId: string,
) => {
  const { deviceId, deviceOwnerId, workingDirectory } = member.config ?? {};
  if (!deviceId || !deviceOwnerId || !workingDirectory) return;
  // A deleted owner took their grants with them; nobody is left to ask.
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, deviceOwnerId))
    .limit(1);
  if (!owner) return;
  const [grant] = await tx
    .insert(channelMemberGrants)
    .values({
      channelId: channel.id,
      deviceId,
      deviceOwnerId,
      memberId: member.id,
      requestedByMemberId: requesterMemberId,
      workingDirectory,
    })
    .onConflictDoNothing({ target: channelMemberGrants.memberId })
    .returning();
  if (grant) await audit(tx, channel.id, 'grant_requested', grant.id);
};

export type ChannelDeviceGrantDecision = 'approve' | 'reject' | 'revoke';

const NEXT_STATUS: Record<
  ChannelDeviceGrantDecision,
  { from: ChannelMemberGrantStatus[]; to: ChannelMemberGrantStatus }
> = {
  approve: { from: ['pending', 'rejected', 'revoked'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  revoke: { from: ['approved'], to: 'revoked' },
};

/**
 * The device owner's decision on one grant. Only the owner recorded on the grant may decide, and
 * only while the member still runs on exactly that device and directory: a grant for an
 * environment that has since moved is stale and cannot be approved into effect.
 */
export const decideDeviceGrant = async (
  db: LobeChatDatabase,
  userId: string,
  grantId: string,
  decision: ChannelDeviceGrantDecision,
) => {
  const [found] = await db
    .select({ channelId: channelMemberGrants.channelId })
    .from(channelMemberGrants)
    .where(eq(channelMemberGrants.id, grantId));
  if (!found) throw new ChannelError('NOT_FOUND', 'Device request not found');

  return db.transaction(async (tx) => {
    await lockChannel(tx, found.channelId);
    const [grant] = await tx
      .select()
      .from(channelMemberGrants)
      .where(eq(channelMemberGrants.id, grantId));
    if (!grant || grant.deviceOwnerId !== userId)
      throw new ChannelError('NOT_FOUND', 'Device request not found');

    const [member] = await tx
      .select({ config: channelMembers.config, status: channelMembers.status })
      .from(channelMembers)
      .where(eq(channelMembers.id, grant.memberId));
    const { deviceId, deviceOwnerId, workingDirectory } = member?.config ?? {};
    if (
      member?.status !== 'active' ||
      deviceId !== grant.deviceId ||
      deviceOwnerId !== grant.deviceOwnerId ||
      workingDirectory !== grant.workingDirectory
    )
      throw new ChannelError('CONFLICT', 'The Agent no longer runs on this device and directory');

    const { from, to } = NEXT_STATUS[decision];
    if (!from.includes(grant.status))
      throw new ChannelError('CONFLICT', `A ${grant.status} request cannot be changed that way`);

    const now = new Date();
    const [updated] = await tx
      .update(channelMemberGrants)
      .set({
        decidedAt: now,
        revokeReason: to === 'revoked' ? 'revoked_by_owner' : null,
        revokedAt: to === 'revoked' ? now : null,
        status: to,
        updatedAt: now,
      })
      .where(eq(channelMemberGrants.id, grantId))
      .returning();
    await audit(tx, grant.channelId, `grant_${to}`, grant.id);
    return updated;
  });
};

const requesters = alias(channelMembers, 'grant_requesters');
const requesterUsers = alias(users, 'grant_requester_users');

/**
 * Grants on the caller's devices in one scope, for the device owner to decide: pending requests
 * first, then what they have approved, newest first. Rejected and revoked ones drop off; asking
 * again (saving the environment anew) brings a request back.
 */
export const listDeviceGrants = async (
  db: LobeChatDatabase,
  userId: string,
  workspaceId: string | null,
) => {
  if (!workspaceId) return [];
  const rows = await db
    .select({
      agentId: channelMembers.agentId,
      agentName: channelMembers.name,
      channelId: channelMemberGrants.channelId,
      channelTitle: channels.title,
      createdAt: channelMemberGrants.createdAt,
      decidedAt: channelMemberGrants.decidedAt,
      deviceId: channelMemberGrants.deviceId,
      deviceName: sql<
        string | null
      >`coalesce(nullif(${devices.friendlyName}, ''), ${devices.hostname})`,
      id: channelMemberGrants.id,
      memberId: channelMemberGrants.memberId,
      requesterName: sql<
        string | null
      >`coalesce(${requesterUsers.fullName}, ${requesterUsers.username})`,
      requesterUserId: requesters.userId,
      status: channelMemberGrants.status,
      workingDirectory: channelMemberGrants.workingDirectory,
    })
    .from(channelMemberGrants)
    .innerJoin(channels, eq(channels.id, channelMemberGrants.channelId))
    .innerJoin(channelMembers, eq(channelMembers.id, channelMemberGrants.memberId))
    .leftJoin(requesters, eq(requesters.id, channelMemberGrants.requestedByMemberId))
    .leftJoin(requesterUsers, eq(requesterUsers.id, requesters.userId))
    .leftJoin(
      devices,
      and(eq(devices.deviceId, channelMemberGrants.deviceId), eq(devices.workspaceId, workspaceId)),
    )
    .where(
      and(
        eq(channelMemberGrants.deviceOwnerId, userId),
        eq(channels.workspaceId, workspaceId),
        notTrashed(channels.isDeleted),
        eq(channelMembers.status, 'active'),
        inArray(channelMemberGrants.status, ['pending', 'approved']),
      ),
    )
    .orderBy(desc(channelMemberGrants.createdAt));
  return rows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
};
