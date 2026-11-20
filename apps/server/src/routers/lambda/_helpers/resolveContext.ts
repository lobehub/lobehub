import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { agentsToSessions } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import {
  batchResolveSessionAgentIds,
  resolveAgentReference,
} from '@/server/services/agent/resolveReference';

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
  workspaceId?: string,
): Promise<ResolvedContext> => {
  const id = input.agentId || input.sessionId;
  let agentId: string | null = null;
  let sessionId: string | null = null;
  if (id) {
    let resolved;
    try {
      resolved = await resolveAgentReference(id, db, userId, workspaceId);
    } catch (error) {
      // Preserve the existing stale-agent fallback, but authorize and write
      // using the fallback's real agent identity, never the stale input.
      if (
        !(error instanceof TRPCError) ||
        error.code !== 'NOT_FOUND' ||
        !input.agentId ||
        !input.sessionId
      )
        throw error;
      resolved = await resolveAgentReference(input.sessionId, db, userId, workspaceId);
    }
    agentId = resolved.agentId;
    sessionId = resolved.sessionId;
    if (!sessionId && agentId) {
      const links = await db
        .select({ sessionId: agentsToSessions.sessionId })
        .from(agentsToSessions)
        .where(
          and(
            eq(agentsToSessions.agentId, agentId),
            buildWorkspaceWhere({ userId, workspaceId }, agentsToSessions),
          ),
        )
        .limit(2);
      // Never select an arbitrary shell when an agent belongs to several.
      if (links.length === 1) {
        try {
          sessionId = (await resolveAgentReference(links[0].sessionId, db, userId, workspaceId))
            .sessionId;
        } catch (error) {
          // An Agent can participate in an old group shell. It remains an
          // Agent context; the group must never become its legacy container.
          if (!(error instanceof TRPCError) || !['NOT_FOUND', 'BAD_REQUEST'].includes(error.code))
            throw error;
        }
      }
    }
  }
  return {
    agentId,
    groupId: input.groupId ?? null,
    sessionId,
    threadId: input.threadId ?? null,
    topicId: input.topicId ?? null,
  };
};

/**
 * Reverse resolution: Get agentId from sessionId
 *
 * Used in scenarios like Topic Router where agentId is needed for queries
 *
 * @param sessionId - session ID
 * @param db - Database instance
 * @param userId - User ID
 * @returns agentId or undefined
 */
export const resolveAgentIdFromSession = async (
  sessionId: string,
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<string | undefined> => {
  return (await resolveAgentReference(sessionId, db, userId, workspaceId)).agentId ?? undefined;
};

/**
 * Resolve a context in both directions so authorization always receives the
 * canonical agent id even from legacy session-only callers.
 */
export const resolveContextWithAgentId = async (
  input: ConversationContextInput,
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<ResolvedContext> => {
  return resolveContext(input, db, userId, workspaceId);
};

/**
 * Batch reverse resolution: Get agentId mapping from multiple sessionIds
 *
 * Used in scenarios requiring batch sessionId -> agentId resolution (e.g., recentTopics)
 *
 * @param sessionIds - Array of session IDs
 * @param db - Database instance
 * @param userId - User ID
 * @returns Map of sessionId -> agentId
 */
export const batchResolveAgentIdFromSessions = async (
  sessionIds: string[],
  db: LobeChatDatabase,
  userId: string,
  workspaceId?: string,
): Promise<Map<string, string>> => {
  return batchResolveSessionAgentIds(sessionIds, db, userId, workspaceId);
};
