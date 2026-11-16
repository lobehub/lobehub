import { and, eq, isNull } from 'drizzle-orm';

import { channelMembers, channels } from '../../schemas';
import type { Transaction } from '../../type';
import type { ChannelAddAgentInput } from './agent';
import { addAgentMember } from './agent';
import { ChannelError } from './error';
import type { ChannelAgentPairAccess } from './types';
import { channelAgentPairKey } from './types';

interface Scope {
  userId: string;
  workspaceId: string | null;
}

/**
 * The conversation in which one of a person's Agents asks another (`channels.agentPairKey`): one
 * per pair, person and scope, opened by either Agent. Its person is the owner member, the
 * execution identity of both Agents, and only watches. An existing conversation opens as it is,
 * with the environments its Agents already have; trashed, it stays there.
 */
export const openAgentPair = async (
  tx: Transaction,
  scope: Scope,
  params: { agents: [ChannelAddAgentInput, ChannelAddAgentInput]; title: string },
): Promise<ChannelAgentPairAccess> => {
  const agentPairKey = channelAgentPairKey(params.agents[0].agentId, params.agents[1].agentId);
  const existing = await findAgentPair(tx, scope, agentPairKey);
  if (existing) return existing;

  // A concurrent open wins the unique index; reuse its row.
  const [channel] = await tx
    .insert(channels)
    .values({
      agentPairKey,
      title: params.title,
      userId: scope.userId,
      visibility: 'private',
      workspaceId: scope.workspaceId,
    })
    .onConflictDoNothing()
    .returning();
  if (!channel) {
    const opened = await findAgentPair(tx, scope, agentPairKey);
    if (opened) return opened;
    throw new ChannelError('CONFLICT', 'The conversation between Agents is unavailable');
  }
  const [member] = await tx
    .insert(channelMembers)
    .values({
      actorType: 'user',
      channelId: channel.id,
      lastReadSequence: 0,
      role: 'owner',
      userId: scope.userId,
    })
    .returning();
  const agents = [];
  for (const agent of params.agents)
    agents.push(await addAgentMember(tx, channel, scope.userId, agent));
  return { agents, channel, member };
};

const findAgentPair = async (
  tx: Transaction,
  { userId, workspaceId }: Scope,
  agentPairKey: string,
): Promise<ChannelAgentPairAccess | undefined> => {
  const [row] = await tx
    .select({ channel: channels, member: channelMembers })
    .from(channels)
    .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
    .where(
      and(
        eq(channels.agentPairKey, agentPairKey),
        eq(channels.userId, userId),
        workspaceId ? eq(channels.workspaceId, workspaceId) : isNull(channels.workspaceId),
        eq(channelMembers.actorType, 'user'),
        eq(channelMembers.userId, userId),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!row) return;
  const agents = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, row.channel.id),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.status, 'active'),
      ),
    );
  return { ...row, agents };
};
