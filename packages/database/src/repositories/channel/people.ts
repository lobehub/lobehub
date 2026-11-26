import type { SQL } from 'drizzle-orm';
import { and, asc, eq, isNull, ne, notExists, or, sql } from 'drizzle-orm';

import { channelMembers, users, workspaceMembers } from '../../schemas';
import type { Transaction } from '../../type';
import { ilikeContains } from '../../utils/like';
import { memberNicknameSql } from '../../utils/workspaceMemberNickname';
import type { ChannelContacts } from './contacts';
import { ChannelError } from './error';
import { requirePeerRelation } from './peer';
import { audit } from './transaction';
import type { ChannelAccess } from './types';

export const requireWorkspaceMember = async (
  tx: Transaction,
  workspaceId: string,
  userId: string,
) => {
  const [member] = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .for('share');
  if (!member) throw new ChannelError('NOT_FOUND', 'Workspace member not found');
};

/** Only group Channels take people; a direct conversation starts a group instead. */
const requireGroup = ({ channel }: ChannelAccess) => {
  if (channel.agentId || channel.peerUserId)
    throw new ChannelError('BAD_REQUEST', 'People can only be added to group channels');
};

/**
 * Who `userId` can bring into a Channel in this scope: in a workspace, its active members; in the
 * personal space, their mutual contacts, the same people they can talk with one-on-one.
 */
const userCandidates = async (
  tx: Transaction,
  contacts: ChannelContacts,
  workspaceId: string | null,
  userId: string,
  exclude: SQL,
  search: string,
) => {
  if (workspaceId) await requireWorkspaceMember(tx, workspaceId, userId);
  const query = search.trim();
  // Inside a workspace a person goes by their nickname there; the membership join below makes
  // `workspace_members` available only in that case.
  const nickname = memberNicknameSql();
  const name = workspaceId
    ? sql<string | null>`coalesce(${nickname}, ${users.fullName})`
    : users.fullName;
  const base = tx
    .select({
      avatar: users.avatar,
      fullName: name,
      userId: users.id,
      username: users.username,
    })
    .from(users);
  const scoped = workspaceId
    ? base.innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.userId, users.id),
          eq(workspaceMembers.workspaceId, workspaceId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
    : base;
  return scoped
    .where(
      and(
        workspaceId ? undefined : contacts.mutualPersonalContactWhere(userId, sql`${users.id}`),
        ne(users.id, userId),
        exclude,
        query
          ? or(
              workspaceId ? ilikeContains(nickname, query) : undefined,
              ilikeContains(users.fullName, query),
              ilikeContains(users.username, query),
            )
          : undefined,
      ),
    )
    .orderBy(asc(name), asc(users.id))
    .limit(50);
};

/**
 * Only people the caller can bring in that are not already active here; search the full
 * directory, not a client-side page. A direct conversation lists them for the group that inviting
 * from it starts.
 */
export const channelUserCandidates = async (
  tx: Transaction,
  contacts: ChannelContacts,
  { channel, member }: ChannelAccess,
  search = '',
) =>
  userCandidates(
    tx,
    contacts,
    channel.workspaceId,
    member.userId!,
    notExists(
      tx
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channel.id),
            eq(channelMembers.userId, users.id),
            eq(channelMembers.status, 'active'),
          ),
        ),
    ),
    search,
  );

/** The people a new Channel in this scope can start with: everyone the creator can bring in. */
export const newChannelUserCandidates = (
  tx: Transaction,
  contacts: ChannelContacts,
  workspaceId: string | null,
  userId: string,
  search = '',
) => userCandidates(tx, contacts, workspaceId, userId, sql`true`, search);

/**
 * Member metadata naming who added the member, merged into what it already holds. A null inviter,
 * someone joining on their own, drops an earlier one so a rejoin does not keep the old adder.
 */
export const memberInviterMetadata = (invitedBy: string | null) =>
  invitedBy
    ? sql`coalesce(${channelMembers.metadata}, '{}'::jsonb) || jsonb_build_object('invitedBy', ${invitedBy}::text)`
    : sql`coalesce(${channelMembers.metadata}, '{}'::jsonb) - 'invitedBy'`;

export const addChannelUser = async (
  tx: Transaction,
  contacts: ChannelContacts,
  access: ChannelAccess,
  userId: string,
) => {
  requireGroup(access);
  const { workspaceId } = access.channel;
  const inviterId = access.member.userId!;
  if (workspaceId) {
    await requireWorkspaceMember(tx, workspaceId, inviterId);
    await requireWorkspaceMember(tx, workspaceId, userId);
  } else if (userId !== inviterId) {
    // A personal group takes the inviter's mutual contacts, checked like a one-on-one chat.
    await requirePeerRelation(tx, contacts, null, inviterId, userId);
  }
  const [existing] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, access.channel.id), eq(channelMembers.userId, userId)));
  if (existing?.status === 'active') return existing;
  const [member] = existing
    ? await tx
        .update(channelMembers)
        .set({
          metadata: memberInviterMetadata(access.member.id),
          role: 'member',
          status: 'active',
        })
        .where(eq(channelMembers.id, existing.id))
        .returning()
    : await tx
        .insert(channelMembers)
        .values({
          actorType: 'user',
          channelId: access.channel.id,
          lastReadSequence: 0,
          metadata: { invitedBy: access.member.id },
          role: 'member',
          userId,
        })
        .returning();
  await audit(tx, access.channel.id, 'member_added', member.id, { actorType: 'user', userId });
  return member;
};
