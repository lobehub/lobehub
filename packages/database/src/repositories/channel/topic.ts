import type { ChannelExecutionConfig } from '@lobechat/types';
import { and, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type { ChannelItem, ChannelJobItem, ChannelMemberItem } from '../../schemas';
import { agentOperations, channelJobs, messages, topics } from '../../schemas';
import type { Transaction } from '../../type';
import { CHANNEL_TOPIC_TRIGGER } from '../../utils/topicVisibility';

// Matches Bot AgentBridgeService: check on the next request, never expire guild Threads.
const TOPIC_STALE_THRESHOLD = 4 * 60 * 60 * 1000;

/**
 * Stored text past which a topic is not continued. Channel history is public and re-readable
 * through the history tools, so a fresh topic loses nothing it cannot read again; rotating here
 * keeps runs off the native context compression, which starts at half the model window (64k
 * tokens for an unknown 128k model). 200k characters is roughly 50k tokens.
 *
 * Measured as the summed length of the topic's message content: tool results and replies are
 * where a long Channel conversation grows, and it is one indexed aggregate per claim.
 */
export const CHANNEL_TOPIC_MAX_CHARS = 200_000;

const topicChars = async (tx: Transaction, topicId: string) => {
  const [row] = await tx
    .select({ chars: sql<number>`coalesce(sum(length(${messages.content})), 0)::int` })
    .from(messages)
    .where(eq(messages.topicId, topicId));

  return row?.chars ?? 0;
};

/**
 * Resolve continuation from the source-side job history, without Channel fields on topics.
 *
 * One topic per member, requester and branch (the main timeline or a Thread). The requester is
 * the run's execution identity: the topic is theirs, and it holds what their runs did with
 * their credentials, devices and tool results. Sharing it with another requester's run would
 * hand that private transcript to someone else, so a member's work for other people reaches
 * this topic only as public replies (marked `self` in the prompt).
 */
export const resolveTopic = async (
  tx: Transaction,
  channel: ChannelItem,
  job: ChannelJobItem,
  member: ChannelMemberItem,
  userId: string,
  requestSequence: number,
  executionConfig: ChannelExecutionConfig,
) => {
  const [previous] = await tx
    .select({ job: channelJobs, operation: agentOperations, topic: topics })
    .from(channelJobs)
    .leftJoin(topics, eq(topics.id, channelJobs.topicId))
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .where(
      and(
        eq(channelJobs.channelId, channel.id),
        eq(channelJobs.memberId, member.id),
        eq(channelJobs.requesterMemberId, job.requesterMemberId),
        job.threadId ? eq(channelJobs.threadId, job.threadId) : isNull(channelJobs.threadId),
        ne(channelJobs.id, job.id),
        isNotNull(channelJobs.claimedAt),
      ),
    )
    .orderBy(desc(channelJobs.claimedAt), desc(channelJobs.id))
    .limit(1);

  const prior = previous?.job;
  const topic = previous?.topic;
  if (
    prior?.manifest &&
    topic &&
    prior.manifest.cutoffSequence < requestSequence &&
    prior.acceptedAt &&
    !prior.writerHeld &&
    !prior.publicationRevoked &&
    !prior.isolatedAt &&
    prior.draft !== null &&
    previous.operation?.status === 'done' &&
    isEqual(prior.executionConfig, executionConfig) &&
    topic.agentId === member.agentId &&
    topic.userId === userId &&
    topic.workspaceId === channel.workspaceId &&
    !topic.isDeleted &&
    (job.threadId || Date.now() - topic.updatedAt.getTime() <= TOPIC_STALE_THRESHOLD) &&
    // Threads never go idle, so size is what bounds them.
    (await topicChars(tx, topic.id)) <= CHANNEL_TOPIC_MAX_CHARS
  ) {
    return topic;
  }

  const [created] = await tx
    .insert(topics)
    .values({
      agentId: member.agentId,
      mode: 'default',
      trigger: CHANNEL_TOPIC_TRIGGER,
      userId,
      workspaceId: channel.workspaceId,
    })
    .returning();
  return created;
};
