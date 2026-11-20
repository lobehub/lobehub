import { and, eq } from 'drizzle-orm';

import { agentOperations, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { OperationCompletionShareVisitor } from '@/server/services/agentRuntime/CompletionLifecycle/types';

/**
 * The share visitor a hetero run on this topic belongs to, or `undefined` for
 * an ordinary run. Read from the marker the dispatch stamped on the operation
 * row, and trusted only when the topic really is that visitor's topic
 * (`topics.senderId`). A visitor topic whose operation has no matching marker
 * also resolves to `undefined`: its rows then stay hidden, which drops the
 * run's output rather than exposing it to the wrong scope.
 */
export const resolveHeteroRunShareVisitor = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  topicId: string;
}): Promise<OperationCompletionShareVisitor | undefined> => {
  const { db, operationId, topicId } = params;
  const [row] = await db
    .select({ metadata: agentOperations.metadata, senderId: topics.senderId })
    .from(agentOperations)
    .innerJoin(topics, eq(topics.id, agentOperations.topicId))
    .where(and(eq(agentOperations.id, operationId), eq(agentOperations.topicId, topicId)))
    .limit(1);
  if (!row?.senderId) return undefined;

  const marker = row.metadata?.agentShareVisitor as
    Partial<OperationCompletionShareVisitor> | undefined;
  if (!marker?.shareId || marker.visitorUserId !== row.senderId) return undefined;
  return { shareId: marker.shareId, visitorUserId: marker.visitorUserId };
};
