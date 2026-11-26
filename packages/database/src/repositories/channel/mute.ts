import { and, eq, inArray } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelJobs, channelMembers } from '../../schemas';
import type { Transaction } from '../../type';
import { requireAgentMember } from './agent';
import { ChannelError } from './error';
import { stopScope } from './stop';
import { audit } from './transaction';
import { OPEN_JOB_STATUSES } from './writer';

/**
 * Mutes or unmutes one Agent member. A muted Agent answers only when a person @mentions it:
 * routing, the paired-Agent shortcut, replies to its messages and its own posts all pass it by.
 * Muting also stops whatever it is answering now, so it falls quiet at once.
 *
 * Returns the stopped jobs whose writer is still held, for the caller to stop physically.
 */
export const setMemberMuted = async (
  tx: Transaction,
  channel: { agentId: string | null; id: string },
  memberId: string,
  muted: boolean,
): Promise<ChannelJobItem[]> => {
  // A direct conversation is a chat with this one Agent; muting it would leave nobody to talk to.
  if (channel.agentId)
    throw new ChannelError('BAD_REQUEST', 'The Agent of a direct conversation cannot be muted');
  const member = await requireAgentMember(tx, channel.id, memberId);
  if (!!member.config?.muted === muted) return [];

  const { muted: _previous, ...rest } = member.config ?? {};
  await tx
    .update(channelMembers)
    .set({ config: muted ? { ...rest, muted: true } : rest })
    .where(eq(channelMembers.id, memberId));
  await audit(tx, channel.id, muted ? 'member_muted' : 'member_unmuted', memberId);
  if (!muted) return [];

  const open = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        eq(channelJobs.channelId, channel.id),
        eq(channelJobs.memberId, memberId),
        inArray(channelJobs.status, [...OPEN_JOB_STATUSES]),
      ),
    );
  const writers: ChannelJobItem[] = [];
  for (const { id } of open) writers.push(...(await stopScope(tx, channel.id, { jobId: id })));
  return writers;
};
