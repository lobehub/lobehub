import type { ChannelExecutionConfig } from '@lobechat/types';
import { and, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import type { ChannelItem, ChannelJobItem, ChannelMemberItem } from '../../schemas';
import { agentOperations, channelJobs, topics } from '../../schemas';
import type { Transaction } from '../../type';
import { CHANNEL_TOPIC_TRIGGER } from '../../utils/topicVisibility';

// Matches Bot AgentBridgeService: check on the next request, never expire guild Threads.
export const TOPIC_STALE_THRESHOLD = 4 * 60 * 60 * 1000;

/**
 * Resolve continuation from the source-side job history, without Channel fields on topics.
 *
 * One topic per member, requester and branch (the main timeline or a Thread). The requester is
 * the run's execution identity: the topic is theirs, and it holds what their runs did with
 * their credentials, devices and tool results. Sharing it with another requester's run would
 * hand that private transcript to someone else, so a member's work for other people reaches
 * this topic only as public replies (marked `self` in the prompt).
 *
 * Another person's shared Agent runs as its owner, so the topic belongs to the owner and its
 * scope, with the requester as `senderId` — the same row a visit to the share page would write,
 * hidden from the owner's own lists.
 */
export interface ChannelTopicScope {
  /** The requester when the run executes as a shared Agent's owner. */
  senderId?: string;
  userId: string;
  workspaceId: string | null;
}

/**
 * The topic this job continues, when it may: the requester's latest settled run for this member
 * and branch, with an unchanged execution config and a fresh enough topic. Undefined starts a new
 * topic. Read-only, so a claim can ask before it commits to running.
 */
export const continuationTopic = async (
  tx: Transaction,
  channel: ChannelItem,
  job: ChannelJobItem,
  member: ChannelMemberItem,
  scope: ChannelTopicScope,
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
    topic.userId === scope.userId &&
    topic.workspaceId === scope.workspaceId &&
    (topic.senderId ?? undefined) === scope.senderId &&
    !topic.isDeleted &&
    (job.threadId || Date.now() - topic.updatedAt.getTime() <= TOPIC_STALE_THRESHOLD) &&
    // A topic another branch is still writing into stays that run's own. Gathering a running
    // peer into a Thread changes only its branch, so its topic would otherwise look settled
    // here: the main timeline would start on it while the gathered run still holds it, and the
    // start reservation would be retired instead of queued.
    !(await topicStillHeld(tx, topic.id))
  )
    return topic;
};

/**
 * The topic a resumed job (`retryJob` in `resume` mode) continues: the one its failed run worked
 * in, kept on the queued job. Only while it is still the same Agent's, in the same scope, not
 * trashed and not held by another run, and only when the run would execute where that one did
 * (runtime, device, directory): a CLI session lives on that machine and in that directory.
 * Undefined starts as a retry would.
 */
export const resumableTopic = async (
  tx: Transaction,
  job: ChannelJobItem,
  member: ChannelMemberItem,
  scope: ChannelTopicScope,
  executionConfig: ChannelExecutionConfig,
) => {
  if (!job.topicId) return;
  const previous = job.executionConfig;
  if (
    previous &&
    (previous.runtime !== executionConfig.runtime ||
      (previous.deviceId ?? null) !== (executionConfig.deviceId ?? null) ||
      (previous.workingDirectory ?? null) !== (executionConfig.workingDirectory ?? null))
  )
    return;
  const [topic] = await tx.select().from(topics).where(eq(topics.id, job.topicId));
  if (
    topic &&
    topic.agentId === member.agentId &&
    topic.userId === scope.userId &&
    topic.workspaceId === scope.workspaceId &&
    (topic.senderId ?? undefined) === scope.senderId &&
    !topic.isDeleted &&
    !(await topicStillHeld(tx, topic.id))
  )
    return topic;
};

/** Whether some run is still writing into this topic, in any branch of its Agent. */
const topicStillHeld = async (tx: Transaction, topicId: string) => {
  const [held] = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(and(eq(channelJobs.topicId, topicId), eq(channelJobs.writerHeld, true)))
    .limit(1);
  return !!held;
};

export const resolveTopic = async (
  tx: Transaction,
  channel: ChannelItem,
  job: ChannelJobItem,
  member: ChannelMemberItem,
  scope: ChannelTopicScope,
  requestSequence: number,
  executionConfig: ChannelExecutionConfig,
) => {
  const topic = await continuationTopic(
    tx,
    channel,
    job,
    member,
    scope,
    requestSequence,
    executionConfig,
  );
  if (topic) {
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
      senderId: scope.senderId,
      trigger: CHANNEL_TOPIC_TRIGGER,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    })
    .returning();
  return created;
};
