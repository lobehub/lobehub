import type { SQL } from 'drizzle-orm';
import { and, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { agentsToSessions, messages, sessions, tasks, threads, topics } from '../../schemas';
import { notTrashed } from '../../utils/softDelete';
import { hasForeignTopicComments } from '../topicComment';
import { type AgentModelContext } from './context';

/**
 * Whether any topic matching `topicWhere` holds a message by someone else.
 *
 * LATERAL with its own LIMIT keeps this a per-topic probe of
 * `messages_topic_id_idx`. A plain join or EXISTS is flattened, and for an
 * agent holding a large share of the table the planner then hashes a Seq Scan
 * of `messages`, the cost this lookup exists to avoid.
 */
const hasForeignMessageInTopics = async (
  ctx: AgentModelContext,
  topicWhere: SQL,
  options: { liveOnly: boolean },
): Promise<boolean> => {
  const foreignMessage = ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.topicId, topics.id),
        ne(messages.userId, ctx.userId),
        options.liveOnly ? notTrashed(messages.isDeleted) : undefined,
      ),
    )
    .limit(1)
    .as('foreign_message');
  const [row] = await ctx.db
    .select({ id: foreignMessage.id })
    .from(topics)
    .innerJoinLateral(foreignMessage, sql`true`)
    .where(topicWhere)
    .limit(1);
  return !!row;
};

/**
 * Transfer an agent and all its associated data to a different workspace or personal account.
 * Runs in a single transaction to ensure atomicity.
 *
 * When moving into a workspace, `targetVisibility` picks the resulting scope
 * within that workspace (`private` = only the target user sees it,
 * `public` = every member does). Ignored when moving to a personal account.
 */
/**
 * Whether the agent's transfer cascade (topics / messages / threads / tasks
 * linked to it) contains rows created by someone else. Transfers rehome every
 * cascaded row, so non-owner members must not move an agent that carries
 * teammates' conversations.
 */
export const transferHasForeignRows = async (
  ctx: AgentModelContext,
  agentId: string | string[],
): Promise<boolean> => {
  const agentIds = Array.isArray(agentId) ? agentId : [agentId];
  if (agentIds.length === 0) return false;

  // The transfer still rehomes the linked session shells, and a member who
  // merely opened the shared agent owns one even with no topics/messages yet.
  const [foreignSession] = await ctx.db
    .select({ id: sessions.id })
    .from(agentsToSessions)
    .innerJoin(sessions, eq(agentsToSessions.sessionId, sessions.id))
    .where(and(inArray(agentsToSessions.agentId, agentIds), ne(sessions.userId, ctx.userId)))
    .limit(1);
  if (foreignSession) return true;

  const topicWhere = inArray(topics.agentId, agentIds);
  const [foreignTopic] = await ctx.db
    .select({ id: topics.id })
    .from(topics)
    .where(and(topicWhere, ne(topics.userId, ctx.userId)))
    .limit(1);
  if (foreignTopic) return true;

  // Comments move (or die, when the target is personal scope) with their
  // topics — a teammate's comment on the caller's own topic is still their
  // work. NULL authors (deleted accounts) count as foreign too.
  if (await hasForeignTopicComments(ctx.db, ctx.userId, topicWhere)) return true;

  // Messages move with their topic whatever agent they carry, and by their
  // own `agent_id` otherwise. Two queries so each one can use its index.
  if (await hasForeignMessageInTopics(ctx, topicWhere, { liveOnly: false })) return true;

  const [foreignMessage] = await ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(inArray(messages.agentId, agentIds), ne(messages.userId, ctx.userId)))
    .limit(1);
  if (foreignMessage) return true;

  const [foreignThread] = await ctx.db
    .select({ id: threads.id })
    .from(threads)
    .where(and(inArray(threads.agentId, agentIds), ne(threads.userId, ctx.userId)))
    .limit(1);
  if (foreignThread) return true;

  const [foreignTask] = await ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        or(inArray(tasks.assigneeAgentId, agentIds), inArray(tasks.createdByAgentId, agentIds)),
        ne(tasks.createdByUserId, ctx.userId),
      ),
    )
    .limit(1);
  return !!foreignTask;
};

/**
 * What deleting the agent takes down besides the caller's own work, for the
 * delete confirmation and the author's delete guard. Mirrors the trash
 * cascade (`softDeleteAgent`), which stamps only the agent, every live topic
 * with its `agent_id` (with its messages and comments) and its topicless
 * messages — linked sessions, rows carrying only a legacy `session_id`,
 * threads and tasks stay where they are, so they never count:
 * - `foreignTopicCount`: live topics other members started under the agent;
 * - `hasForeignContent`: that, or a teammate's comment / message riding along
 *   inside the caller's own topics or among the topicless messages.
 */
export const getDeleteImpact = async (
  ctx: AgentModelContext,
  agentId: string,
): Promise<{ foreignTopicCount: number; hasForeignContent: boolean }> => {
  const topicWhere = and(eq(topics.agentId, agentId), notTrashed(topics.isDeleted))!;

  // Independent lookups, each on its own index. The message check is split in
  // two because one LEFT JOIN with an OR across both tables can use neither
  // and walks the whole messages table when nothing foreign exists.
  const [[topicRow], hasForeignComment, hasForeignTopicMessage, [foreignTopiclessMessage]] =
    await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(topics)
        .where(and(topicWhere, ne(topics.userId, ctx.userId))),
      // NULL authors (deleted accounts) count as foreign.
      hasForeignTopicComments(ctx.db, ctx.userId, topicWhere),
      // Every message inside an affected live topic, whatever agent it carries.
      hasForeignMessageInTopics(ctx, topicWhere, { liveOnly: true }),
      // The topicless messages `softDeleteTopicless` stamps.
      ctx.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.agentId, agentId),
            isNull(messages.topicId),
            ne(messages.userId, ctx.userId),
            notTrashed(messages.isDeleted),
          ),
        )
        .limit(1),
    ]);
  const foreignTopicCount = Number(topicRow?.count ?? 0);

  return {
    foreignTopicCount,
    hasForeignContent:
      foreignTopicCount > 0 ||
      hasForeignComment ||
      hasForeignTopicMessage ||
      !!foreignTopiclessMessage,
  };
};
