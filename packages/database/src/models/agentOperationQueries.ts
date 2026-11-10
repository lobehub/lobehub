import { and, desc, eq, gt, inArray, ne, type SQL, sql } from 'drizzle-orm';

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

export interface PreviousCostedOperation {
  /** `cost.reportedSessionTotal`, set when the server de-cumulated the op's cost. */
  reportedSessionTotal: number | null;
  totalCost: number;
}

/**
 * The most recent op on a topic, started before `operationId`, that ran on
 * `provider` and booked a positive cost. Rides `agent_operations_topic_id_idx`
 * (a topic holds few ops) and reads one row.
 */
export const findPreviousCostedTopicOperation = async (
  db: LobeChatDatabase,
  ownership: SQL | undefined,
  params: { operationId: string; provider: string; topicId: string },
): Promise<PreviousCostedOperation | null> => {
  const [row] = await db
    .select({
      reportedSessionTotal: sql<string | null>`${agentOperations.cost}->>'reportedSessionTotal'`,
      totalCost: agentOperations.totalCost,
    })
    .from(agentOperations)
    .where(
      and(
        ownership,
        eq(agentOperations.topicId, params.topicId),
        eq(agentOperations.provider, params.provider),
        gt(agentOperations.totalCost, 0),
        ne(agentOperations.id, params.operationId),
        // Earlier than the finishing op. Falls back to "now" when that op has no
        // start time, so a missing row never hides every candidate.
        sql`${agentOperations.startedAt} < coalesce((select a2.started_at from ${agentOperations} a2 where a2.id = ${params.operationId}), now())`,
      ),
    )
    .orderBy(desc(agentOperations.startedAt))
    .limit(1);
  if (!row) return null;

  const reported = row.reportedSessionTotal == null ? null : Number(row.reportedSessionTotal);
  return {
    reportedSessionTotal: reported !== null && Number.isFinite(reported) ? reported : null,
    totalCost: Number(row.totalCost ?? 0),
  };
};
