import type { ChannelExecutionConfig } from '@lobechat/types';
import { and, count, desc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import isEqual from 'fast-deep-equal';

import { AgentShareModel } from '../../models/agentShare';
import type { ChannelItem, ChannelJobItem, ChannelMemberItem } from '../../schemas';
import { agentOperations, channelJobs, messages, topics } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
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
 *
 * Another person's shared Agent runs as its owner, so the topic belongs to the owner and its
 * scope, with the requester as `senderId` — the same row a visit to the share page would write,
 * hidden from the owner's own lists. Such a topic also ends at the share's per-topic turn limit,
 * where the share page would ask for a new conversation.
 */
export interface ChannelTopicScope {
  /** The requester when the run executes as a shared Agent's owner. */
  senderId?: string;
  userId: string;
  workspaceId: string | null;
}

export const resolveTopic = async (
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
    !(executionConfig.share && (await reachedShareTurnLimit(tx, member.agentId!, topic.id)))
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

  if (scope.senderId)
    await reserveShareTopic(tx, member.agentId!, { ...scope, senderId: scope.senderId });

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

/** The share's per-visitor topic cap is reached; the request waits until the owner allows more. */
export class ShareTopicLimitError extends Error {
  constructor() {
    super('This shared Agent reached its conversation limit for you');
  }
}

/**
 * A new topic for a visitor counts against the share's `maxTopicsPerVisitor`, the same counter a
 * share-page visit uses: topics of this Agent the visitor started under the owner, the Channel's
 * included. Locks the Agent row the share page locks before it counts, so the two never both
 * take the last slot.
 */
const reserveShareTopic = async (
  tx: Transaction,
  agentId: string,
  scope: Required<Pick<ChannelTopicScope, 'senderId'>> & ChannelTopicScope,
) => {
  const db = tx as unknown as LobeChatDatabase;
  await AgentShareModel.lockScopedAgentRow(db, agentId, {
    userId: scope.userId,
    workspaceId: scope.workspaceId ?? undefined,
  });
  const { maxTopicsPerVisitor } = await AgentShareModel.readCurrentVisitorCaps(db, agentId);
  const [started] = await tx
    .select({ value: count() })
    .from(topics)
    .where(
      and(
        eq(topics.agentId, agentId),
        eq(topics.userId, scope.userId),
        eq(topics.senderId, scope.senderId),
        notTrashed(topics.isDeleted),
      ),
    );
  if ((started?.value ?? 0) >= maxTopicsPerVisitor) throw new ShareTopicLimitError();
};

const reachedShareTurnLimit = async (tx: Transaction, agentId: string, topicId: string) => {
  const { maxTurnsPerTopic: limit } = await AgentShareModel.readCurrentVisitorCaps(
    tx as unknown as LobeChatDatabase,
    agentId,
  );
  const [turns] = await tx
    .select({ value: count() })
    .from(messages)
    .where(and(eq(messages.topicId, topicId), eq(messages.role, 'user')));
  return (turns?.value ?? 0) >= limit;
};
