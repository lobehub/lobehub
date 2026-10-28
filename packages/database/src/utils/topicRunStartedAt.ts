import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { agentOperations, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * When the topic's current run started, so a list can show a live elapsed
 * clock instead of `updatedAt` (which moves on every message write). Every
 * topic list that renders running rows must select this — a row whose
 * persisted status is `running` but which lacks it shows a spinner with no
 * timer whenever the client holds no local operation for the topic.
 *
 * Resolution order:
 * 1. The latest *top-level* running operation is the current run:
 *    sub-operations (callAgent) would restart the clock at their own spawn
 *    time, and an abandoned `running` row from a crashed earlier run sorts
 *    below the live one. Not scoped by `ownership()` — in a workspace the run
 *    may have been started by another member, and the topic join is already
 *    ownership-gated.
 * 2. Client-executed runs (desktop heterogeneous CLI, in-browser runtime)
 *    never reach `agent_operations`, so their start is stamped onto
 *    `metadata.runStartedAt` by the status write that claims the topic (see
 *    `TopicModel.update`). The operation row wins when both exist: it is the
 *    server's own record of the run, while the stamp is a client-reported time.
 *
 * CASE-gated so only rows that are actually running pay for the lookup — and
 * a stale running op (or stamp) under a finished topic can't resurrect a timer.
 */
export const topicRunStartedAtColumn = (db: LobeChatDatabase) => {
  const operationStartedAt = db
    .select({ value: agentOperations.startedAt })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.topicId, topics.id),
        eq(agentOperations.status, 'running'),
        isNull(agentOperations.parentOperationId),
        isNotNull(agentOperations.startedAt),
      ),
    )
    .orderBy(desc(agentOperations.startedAt))
    .limit(1);
  const stampedStartedAt = sql`(${topics.metadata} ->> 'runStartedAt')::timestamptz`;

  return sql<Date | null>`CASE WHEN ${topics.status} = 'running' THEN COALESCE((${operationStartedAt}), ${stampedStartedAt}) ELSE NULL END`
    .mapWith(agentOperations.startedAt)
    .as('run_started_at');
};
