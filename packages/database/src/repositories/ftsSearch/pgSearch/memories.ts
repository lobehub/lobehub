import { and, eq, sql } from 'drizzle-orm';

import { userMemories } from '../../../schemas';
import type { FtsSearchBackendResponse, FtsSearchMemoryResult } from '../types';
import type { PgFtsSearchField } from './dialect';
import { buildResponse, truncate } from './results';
import type { PgSearchFtsSearchContext } from './scope';

const MEMORY_FIELDS: PgFtsSearchField[] = [
  { column: userMemories.title, weight: 4 },
  { column: userMemories.summary, weight: 2 },
  { column: userMemories.details },
];

/** Search user memories by title, summary, and details. */
export async function searchMemories(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
): Promise<FtsSearchBackendResponse<FtsSearchMemoryResult>> {
  const { db, dialect } = context;
  const preparedQuery = dialect.prepare(query);
  const score = dialect.score(userMemories.id, MEMORY_FIELDS, preparedQuery);

  // Memories are user-scoped and have no workspace column, so the ownership
  // predicate can remain in the single-table scored scan.
  const rows = await db
    .select({
      createdAt: userMemories.createdAt,
      id: userMemories.id,
      memoryLayer: userMemories.memoryLayer,
      score,
      summary: userMemories.summary,
      title: userMemories.title,
      updatedAt: userMemories.updatedAt,
    })
    .from(userMemories)
    .where(
      and(eq(userMemories.userId, context.userId), dialect.match(MEMORY_FIELDS, preparedQuery)),
    )
    .orderBy(sql`${score} DESC`)
    .limit(limit);

  return buildResponse(rows, (row) => ({
    createdAt: row.createdAt,
    description: truncate(row.summary),
    id: row.id,
    memoryLayer: row.memoryLayer,
    relevance: row.relevance,
    title: row.title || 'Untitled Memory',
    type: 'memory' as const,
    updatedAt: row.updatedAt,
  }));
}
