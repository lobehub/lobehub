import { and, eq, sql } from 'drizzle-orm';

import { userMemories } from '../../../schemas';
import { sanitizeBm25Query } from '../../../utils/bm25';
import type { FtsSearchBackendResponse, FtsSearchMemoryResult } from '../types';
import { buildResponse, truncate } from './results';
import type { PgSearchFtsSearchContext } from './scope';

/** Search user memories by title, summary, and details. */
export async function searchMemories(
  context: PgSearchFtsSearchContext,
  query: string,
  limit: number,
): Promise<FtsSearchBackendResponse<FtsSearchMemoryResult>> {
  const bm25Query = sanitizeBm25Query(query);
  const { db } = context;

  // Memories are user-scoped and have no workspace column, so the ownership
  // predicate can remain in the single-table BM25 scan.
  const rows = await db
    .select({
      createdAt: userMemories.createdAt,
      id: userMemories.id,
      memoryLayer: userMemories.memoryLayer,
      score: sql<number>`paradedb.score(${userMemories.id})`,
      summary: userMemories.summary,
      title: userMemories.title,
      updatedAt: userMemories.updatedAt,
    })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, context.userId),
        sql`(${userMemories.title} @@@ ${bm25Query} OR ${userMemories.summary} @@@ ${bm25Query} OR ${userMemories.details} @@@ ${bm25Query})`,
      ),
    )
    .orderBy(sql`paradedb.score(${userMemories.id}) DESC`)
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
