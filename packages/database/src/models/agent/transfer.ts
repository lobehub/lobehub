import { and, count, eq, inArray, ne, or } from 'drizzle-orm';

import { agentsToSessions, messages, sessions, tasks, threads, topics } from '../../schemas';
import { notTrashed } from '../../utils/softDelete';
import { hasForeignTopicComments } from '../topicComment';
import { type AgentModelContext } from './context';

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

  const links = await ctx.db
    .select({ sessionId: agentsToSessions.sessionId })
    .from(agentsToSessions)
    .where(inArray(agentsToSessions.agentId, agentIds));
  const sessionIds = [...new Set(links.map((link) => link.sessionId))];

  // A member who merely opened the shared agent already owns a linked
  // session, even with no topics/messages yet — the transfer would rewrite
  // that session row too.
  if (sessionIds.length > 0) {
    const [foreignSession] = await ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(inArray(sessions.id, sessionIds), ne(sessions.userId, ctx.userId)))
      .limit(1);
    if (foreignSession) return true;
  }

  const topicWhere =
    sessionIds.length > 0
      ? or(inArray(topics.sessionId, sessionIds), inArray(topics.agentId, agentIds))
      : inArray(topics.agentId, agentIds);
  const [foreignTopic] = await ctx.db
    .select({ id: topics.id })
    .from(topics)
    .where(and(topicWhere, ne(topics.userId, ctx.userId)))
    .limit(1);
  if (foreignTopic) return true;

  // Comments move (or die, when the target is personal scope) with their
  // topics — a teammate's comment on the caller's own topic is still their
  // work. NULL authors (deleted accounts) count as foreign too.
  if (await hasForeignTopicComments(ctx.db, ctx.userId, topicWhere!)) return true;

  const messageWhere =
    sessionIds.length > 0
      ? or(inArray(messages.sessionId, sessionIds), inArray(messages.agentId, agentIds))
      : inArray(messages.agentId, agentIds);
  const [foreignMessage] = await ctx.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(messageWhere, ne(messages.userId, ctx.userId)))
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
 * delete confirmation: how many live topics other members started under it,
 * and whether anything foreign at all (sessions, comments on the caller's
 * topics, messages, threads, tasks) rides along with the cascade.
 */
export const getDeleteImpact = async (
  ctx: AgentModelContext,
  agentId: string,
): Promise<{ foreignTopicCount: number; hasForeignContent: boolean }> => {
  const links = await ctx.db
    .select({ sessionId: agentsToSessions.sessionId })
    .from(agentsToSessions)
    .where(eq(agentsToSessions.agentId, agentId));
  const sessionIds = [...new Set(links.map((link) => link.sessionId))];

  const topicWhere =
    sessionIds.length > 0
      ? or(inArray(topics.sessionId, sessionIds), eq(topics.agentId, agentId))
      : eq(topics.agentId, agentId);
  const [row] = await ctx.db
    .select({ count: count() })
    .from(topics)
    .where(and(topicWhere, ne(topics.userId, ctx.userId), notTrashed(topics.isDeleted)));
  const foreignTopicCount = Number(row?.count ?? 0);

  const hasForeignContent = foreignTopicCount > 0 || (await transferHasForeignRows(ctx, agentId));

  return { foreignTopicCount, hasForeignContent };
};
