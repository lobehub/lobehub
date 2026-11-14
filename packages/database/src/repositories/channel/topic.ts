import type { ChannelExecutionConfig } from '@lobechat/types';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type { ChannelItem, ChannelJobItem, ChannelMemberItem } from '../../schemas';
import { agentOperations, channelJobs, topics } from '../../schemas';
import type { Transaction } from '../../type';
import { CHANNEL_TOPIC_TRIGGER } from '../../utils/topicVisibility';

// Matches Bot AgentBridgeService: check on the next request, never expire guild Threads.
const TOPIC_STALE_THRESHOLD = 4 * 60 * 60 * 1000;

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
    (job.threadId || Date.now() - topic.updatedAt.getTime() <= TOPIC_STALE_THRESHOLD)
  ) {
    // A Channel that belongs to a project runs inside it, so the topic it works in
    // must say which project it belongs to: that binding is what the run resolves
    // its project context from (project prompt, coordinator scope, task ownership).
    // Topics created before the Channel was bound carry none — adopt the Channel's
    // project once. A topic already bound elsewhere is never re-homed by a run.
    if (!topic.projectId && channel.projectId) {
      const [adopted] = await tx
        .update(topics)
        .set({ projectId: channel.projectId })
        .where(eq(topics.id, topic.id))
        .returning();
      return adopted ?? topic;
    }
    return topic;
  }

  const [created] = await tx
    .insert(topics)
    .values({
      agentId: member.agentId,
      mode: 'default',
      // The Channel's project, read from the Channel itself (never inferred from the
      // Agent), so a conversation started by a project Channel is born in the project.
      projectId: channel.projectId ?? undefined,
      trigger: CHANNEL_TOPIC_TRIGGER,
      userId,
      workspaceId: channel.workspaceId,
    })
    .returning();
  return created;
};
