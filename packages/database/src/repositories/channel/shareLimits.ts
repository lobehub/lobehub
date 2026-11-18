import {
  AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR,
  AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC,
  SHARE_VISITOR_PROMPT_MAX_LENGTH,
} from '@lobechat/const';
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { agentShares, channelJobs, messages, topics } from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { ChannelError } from './error';
import { TOPIC_STALE_THRESHOLD } from './topic';

/**
 * Admission for a message sent to another person's shared Agent, with the limits its share page
 * applies to a visitor, so the composer is told at send time instead of the reply failing later.
 *
 * - The prompt length cap (`SHARE_VISITOR_PROMPT_MAX_LENGTH`).
 * - `maxTopicsPerVisitor`: a conversation starts a new topic (`resolveTopic`) when the visitor has
 *   none to continue, so the send is refused only when the visitor is at the cap and the topic
 *   this conversation would continue cannot take another turn (`maxTurnsPerTopic` reached, or
 *   idle past the staleness window). That topic is the one of the visitor's latest claimed run in
 *   the same Channel and Thread, as `continuationTopic` selects it; a Thread continues its topic
 *   regardless of staleness.
 *
 * Like the spend limit, a send-time guardrail rather than an atomic reservation: the turn cap
 * itself is still enforced atomically when the run writes the visitor's message
 * (`reserveShareVisitorTurn`), and a run that needs a topic beyond the cap fails there.
 */
export const assertSharedAgentAdmission = async (
  tx: Transaction,
  params: {
    agentId: string;
    channelId: string;
    content: string;
    ownerId: string;
    requesterMemberId: string;
    threadId: string | null;
    visitorId: string;
  },
) => {
  const { agentId, channelId, content, ownerId, requesterMemberId, threadId, visitorId } = params;
  if (content.length > SHARE_VISITOR_PROMPT_MAX_LENGTH)
    throw new ChannelError(
      'BAD_REQUEST',
      `Messages to a shared Agent are limited to ${SHARE_VISITOR_PROMPT_MAX_LENGTH} characters`,
    );

  const [share] = await tx
    .select({ config: agentShares.shareConfig })
    .from(agentShares)
    .where(eq(agentShares.agentId, agentId))
    .limit(1);
  const maxTopics =
    share?.config?.maxTopicsPerVisitor ?? AGENT_SHARE_DEFAULT_MAX_TOPICS_PER_VISITOR;
  const maxTurns = share?.config?.maxTurnsPerTopic ?? AGENT_SHARE_DEFAULT_MAX_TURNS_PER_TOPIC;

  const visitorTopics = and(
    eq(topics.agentId, agentId),
    eq(topics.senderId, visitorId),
    eq(topics.userId, ownerId),
    notTrashed(topics.isDeleted),
  );
  const [{ value: topicCount }] = await tx
    .select({ value: count() })
    .from(topics)
    .where(visitorTopics);
  if (topicCount < maxTopics) return;

  const [latest] = await tx
    .select({ id: topics.id, updatedAt: topics.updatedAt })
    .from(channelJobs)
    .innerJoin(topics, eq(topics.id, channelJobs.topicId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        eq(channelJobs.requesterMemberId, requesterMemberId),
        threadId ? eq(channelJobs.threadId, threadId) : isNull(channelJobs.threadId),
        isNotNull(channelJobs.claimedAt),
        visitorTopics,
      ),
    )
    .orderBy(desc(channelJobs.claimedAt), desc(channelJobs.id))
    .limit(1);
  if (latest) {
    const [turns] = await tx
      .select({ value: count() })
      .from(messages)
      .where(and(eq(messages.topicId, latest.id), eq(messages.role, 'user')));
    const fresh = !!threadId || Date.now() - latest.updatedAt.getTime() <= TOPIC_STALE_THRESHOLD;
    if (fresh && (turns?.value ?? 0) < maxTurns) return;
  }
  throw new ChannelError(
    'TOO_MANY_REQUESTS',
    `You have reached the limit of ${maxTopics} conversations with this Agent`,
  );
};
