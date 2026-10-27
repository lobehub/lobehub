import { and, asc, eq, isNull, notExists, or } from 'drizzle-orm';

import { channelMembers, users, workspaceMembers } from '../../schemas';
import type { Transaction } from '../../type';
import { ilikeContains } from '../../utils/like';
import { ChannelError } from './error';
import { audit } from './transaction';
import type { ChannelAccess } from './types';

const requireWorkspaceMember = async (tx: Transaction, workspaceId: string, userId: string) => {
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

const requireGroupWorkspace = async (tx: Transaction, { channel, member }: ChannelAccess) => {
  if (!channel.workspaceId || channel.agentId)
    throw new ChannelError('BAD_REQUEST', 'People can only be added to workspace group channels');
  await requireWorkspaceMember(tx, channel.workspaceId, member.userId!);
  return channel.workspaceId;
};

/** Only active people in this workspace; search the full directory, not a client-side page. */
export const channelUserCandidates = async (
  tx: Transaction,
  access: ChannelAccess,
  search = '',
) => {
  const workspaceId = await requireGroupWorkspace(tx, access);
  const query = search.trim();
  return tx
    .select({
      avatar: users.avatar,
      fullName: users.fullName,
      userId: users.id,
      username: users.username,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        isNull(workspaceMembers.deletedAt),
        notExists(
          tx
            .select({ id: channelMembers.id })
            .from(channelMembers)
            .where(
              and(
                eq(channelMembers.channelId, access.channel.id),
                eq(channelMembers.userId, users.id),
                eq(channelMembers.status, 'active'),
              ),
            ),
        ),
        query
          ? or(ilikeContains(users.fullName, query), ilikeContains(users.username, query))
          : undefined,
      ),
    )
    .orderBy(asc(users.fullName), asc(users.id))
    .limit(50);
};

export const addChannelUser = async (tx: Transaction, access: ChannelAccess, userId: string) => {
  const workspaceId = await requireGroupWorkspace(tx, access);
  await requireWorkspaceMember(tx, workspaceId, userId);
  const [existing] = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, access.channel.id), eq(channelMembers.userId, userId)));
  if (existing?.status === 'active') return existing;
  const [member] = existing
    ? await tx
        .update(channelMembers)
        .set({ role: 'member', status: 'active' })
        .where(eq(channelMembers.id, existing.id))
        .returning()
    : await tx
        .insert(channelMembers)
        .values({
          actorType: 'user',
          channelId: access.channel.id,
          lastReadSequence: 0,
          role: 'member',
          userId,
        })
        .returning();
  await audit(tx, access.channel.id, 'member_added', member.id, { actorType: 'user', userId });
  return member;
};
