import { and, eq, inArray } from 'drizzle-orm';

import { agentsToSessions } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';

import { type ConversationContextInput } from '../_schema/context';

export interface ResolvedContext {
  agentId: string | null;
  groupId: string | null;
  sessionId: string | null;
  threadId: string | null;
  topicId: string | null;
}

/**
 * Resolve conversation context
 *
 * Resolves agentId to sessionId (if agentId is provided)
 * Priority: agentId > sessionId
 *
 * @param input - Input context parameters
 * @param db - Database instance
 * @param userId - User ID
 * @returns Resolved context with sessionId resolved from agentId
 */
export const resolveContext = async (
  input: ConversationContextInput,
  db: LobeChatDatabase,
  userId: string,
): Promise<ResolvedContext> => {
  let resolvedSessionId: string | null = input.sessionId ?? null;

  // If agentId is provided, prioritize looking up the corresponding sessionId from agentsToSessions table
  if (input.agentId) {
    const [relation] = await db
      .select({ sessionId: agentsToSessions.sessionId })
      .from(agentsToSessions)
      .where(and(eq(agentsToSessions.agentId, input.agentId), eq(agentsToSessions.userId, userId)))
      .limit(1);

    if (relation) {
      resolvedSessionId = relation.sessionId;
    }
  }

  return {
    agentId: input.agentId ?? null,
    groupId: input.groupId ?? null,
    sessionId: resolvedSessionId,
    threadId: input.threadId ?? null,
    topicId: input.topicId ?? null,
  };
};

/**
 * 反向解析：从 sessionId 获取 agentId
 *
 * 用于 Topic Router 等需要 agentId 进行查询的场景
 *
 * @param sessionId - session ID
 * @param db - 数据库实例
 * @param userId - 用户 ID
 * @returns agentId 或 undefined
 */
export const resolveAgentIdFromSession = async (
  sessionId: string,
  db: LobeChatDatabase,
  userId: string,
): Promise<string | undefined> => {
  const [relation] = await db
    .select({ agentId: agentsToSessions.agentId })
    .from(agentsToSessions)
    .where(and(eq(agentsToSessions.sessionId, sessionId), eq(agentsToSessions.userId, userId)))
    .limit(1);

  return relation?.agentId;
};

/**
 * 批量反向解析：从多个 sessionId 获取 agentId 映射
 *
 * 用于需要批量解析 sessionId -> agentId 的场景（如 recentTopics）
 *
 * @param sessionIds - session ID 数组
 * @param db - 数据库实例
 * @param userId - 用户 ID
 * @returns sessionId -> agentId 的映射 Map
 */
export const batchResolveAgentIdFromSessions = async (
  sessionIds: string[],
  db: LobeChatDatabase,
  userId: string,
): Promise<Map<string, string>> => {
  if (sessionIds.length === 0) return new Map();

  const relations = await db
    .select({ agentId: agentsToSessions.agentId, sessionId: agentsToSessions.sessionId })
    .from(agentsToSessions)
    .where(and(eq(agentsToSessions.userId, userId), inArray(agentsToSessions.sessionId, sessionIds)));

  return new Map(relations.map((r) => [r.sessionId, r.agentId]));
};
