import { and, eq, getTableColumns, inArray, or, sql } from 'drizzle-orm';

import type {
  ChannelMemberItem,
  ChannelMessageItem,
  ChannelThreadItem,
  NewChannelMessage,
} from '../../schemas';
import {
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
} from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { ChannelError } from './error';

/** The Thread a message belongs to, or null for the main channel. */
export const findThread = async (
  tx: Transaction,
  channelId: string,
  threadId?: string | null,
): Promise<ChannelThreadItem | null> => {
  if (!threadId) return null;

  const [thread] = await tx
    .select()
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelId, channelId),
        eq(channelThreads.id, threadId),
        notTrashed(channelThreads.isDeleted),
      ),
    );
  if (!thread) throw new ChannelError('NOT_FOUND', 'Thread not found');

  return thread;
};

/** Rejects a write into an archived Thread; it stays readable until an admin unarchives it. */
export const assertThreadOpen = (thread: ChannelThreadItem | null) => {
  if (thread?.status === 'archived') throw new ChannelError('CONFLICT', 'Thread is archived');
  return thread;
};

/** Active members by id. Throws when any of them is missing or has left. */
export const activeMembers = async (
  tx: Transaction,
  channelId: string,
  memberIds: string[],
): Promise<ChannelMemberItem[]> => {
  const unique = [...new Set(memberIds)];
  if (!unique.length) return [];

  const members = await tx
    .select(getTableColumns(channelMembers))
    .from(channelMembers)
    .leftJoin(agents, eq(agents.id, channelMembers.agentId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.status, 'active'),
        inArray(channelMembers.id, unique),
        or(
          eq(channelMembers.actorType, 'user'),
          and(sql`${agents.id} IS NOT NULL`, notTrashed(agents.isDeleted)),
        ),
      ),
    );
  if (members.length !== unique.length)
    throw new ChannelError('BAD_REQUEST', 'A selected member is unavailable');

  return members;
};

/**
 * Agents that may answer a message without @mentions: every active Agent on the main
 * channel, the following Agents inside a Thread.
 */
export const candidateAgents = async (
  tx: Transaction,
  channelId: string,
  thread: ChannelThreadItem | null,
): Promise<ChannelMemberItem[]> => {
  const members = await tx
    .select(getTableColumns(channelMembers))
    .from(channelMembers)
    .innerJoin(agents, eq(agents.id, channelMembers.agentId))
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.status, 'active'),
        notTrashed(agents.isDeleted),
      ),
    );

  return thread ? members.filter((agent) => thread.followerMemberIds.includes(agent.id)) : members;
};

/**
 * The only Agent of a group with exactly one active person and one active Agent. Such a
 * group needs no responder decision: every message the person sends goes to this Agent.
 */
export const pairedAgent = async (
  tx: Transaction,
  channelId: string,
): Promise<ChannelMemberItem | undefined> => {
  const members = await tx
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.status, 'active')));
  const agents = members.filter((member) => member.actorType === 'agent');

  return agents.length === 1 && members.length === 2 ? agents[0] : undefined;
};

/**
 * Queues one job per message and Agent member. Skips Agents whose
 * environment changed after the message, so a late route cannot run an old instruction
 * in a new directory. Returns the ids of the Agents that received a job.
 */
export const deliver = async (
  tx: Transaction,
  message: ChannelMessageItem,
  agents: ChannelMemberItem[],
  requesterMemberId: string,
): Promise<string[]> => {
  const recipients = agents.filter((agent) => agent.actorType === 'agent');
  if (!recipients.length) return [];

  await tx
    .insert(channelJobs)
    .values(
      recipients.map((agent) => ({
        channelId: message.channelId,
        memberId: agent.id,
        messageId: message.id,
        requesterMemberId,
        threadId: message.threadId,
      })),
    )
    .onConflictDoNothing();

  return recipients.map((agent) => agent.id);
};

/** Appends a message at the next channel sequence. The caller holds the channel lock. */
export const appendMessage = async (
  tx: Transaction,
  values: Omit<NewChannelMessage, 'sequence' | 'id'> & { id?: string },
): Promise<ChannelMessageItem> => {
  const isReply = values.routingStatus === 'reply';
  if (isReply ? !values.agentId || values.userId != null : !values.userId || values.agentId != null)
    throw new ChannelError(
      'BAD_REQUEST',
      'A message requires exactly one sender of the correct type',
    );
  const [{ sequence }] = await tx
    .update(channels)
    .set({ sequence: sql`${channels.sequence} + 1` })
    .where(eq(channels.id, values.channelId))
    .returning({ sequence: channels.sequence });
  const [message] = await tx
    .insert(channelMessages)
    .values({ ...values, sequence })
    .returning();

  return message;
};
