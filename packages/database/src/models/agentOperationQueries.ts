import { and, desc, eq, gte, inArray, type SQL } from 'drizzle-orm';

import { agentOperations } from '../schemas/agentOperations';
import type { LobeChatDatabase } from '../type';

export const findScopedOperation = async (
  db: LobeChatDatabase,
  ownership: SQL | undefined,
  operationId: string,
) => {
  const [row] = await db
    .select()
    .from(agentOperations)
    .where(and(eq(agentOperations.id, operationId), ownership))
    .limit(1);
  return row ?? null;
};

export const findLiveTopicOperations = (
  db: LobeChatDatabase,
  ownership: SQL | undefined,
  topicId: string,
) =>
  db
    .select()
    .from(agentOperations)
    .where(
      and(
        ownership,
        eq(agentOperations.topicId, topicId),
        inArray(agentOperations.status, [
          'running',
          'waiting_for_human',
          'waiting_for_async_tool',
          'waiting_for_client',
        ]),
      ),
    );

/**
 * The newest run of `agentId` by `userId` since `since` that finished on its own: done or
 * failed. A stopped or abandoned run says nothing about whether the Agent can run now.
 */
export const findLatestSettledAgentRun = async (
  db: LobeChatDatabase,
  ownership: SQL | undefined,
  params: { agentId: string; since: Date; userId: string },
) => {
  const [row] = await db
    .select({
      createdAt: agentOperations.createdAt,
      error: agentOperations.error,
      id: agentOperations.id,
      status: agentOperations.status,
    })
    .from(agentOperations)
    .where(
      and(
        ownership,
        eq(agentOperations.agentId, params.agentId),
        eq(agentOperations.userId, params.userId),
        inArray(agentOperations.status, ['done', 'error']),
        gte(agentOperations.createdAt, params.since),
      ),
    )
    .orderBy(desc(agentOperations.createdAt))
    .limit(1);
  return row ?? null;
};
