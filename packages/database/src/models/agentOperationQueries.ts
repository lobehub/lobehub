import { and, eq, inArray, type SQL } from 'drizzle-orm';

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
