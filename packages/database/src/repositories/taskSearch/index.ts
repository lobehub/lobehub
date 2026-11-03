import { and, asc, desc, eq, or, type SQL, sql } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { escapeLike, ilikeContains } from '../../utils/like';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { FtsSearchTaskResult } from '../ftsSearch/types';

export interface TaskSearchOptions {
  limit?: number;
  query: string;
}

/** A bare task number (`827` or `#827`) — longer runs cannot be a valid `seq`. */
const SEQ_PATTERN = /^#?(\d{1,9})$/;

/**
 * Command-menu lookup for tasks by identifier or name.
 *
 * Tasks are not part of the full-text index, so this queries the `tasks` table
 * directly with the same visibility-aware ownership as `TaskModel.ownership()`:
 * public workspace tasks plus the caller's own private ones, never trashed rows.
 */
export class TaskSearchRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  search = async ({ limit = 5, query }: TaskSearchOptions): Promise<FtsSearchTaskResult[]> => {
    const text = query.trim();
    if (!text || limit <= 0) return [];

    const seqMatch = text.match(SEQ_PATTERN);
    const identifierExact = sql`upper(${tasks.identifier}) = ${text.toUpperCase()}`;
    const exact = seqMatch
      ? (or(identifierExact, eq(tasks.seq, Number(seqMatch[1]))) as SQL)
      : identifierExact;
    const identifierPrefix = sql`${tasks.identifier} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
    const namePrefix = sql`${tasks.name} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;

    // Lower is better, matching FtsSearchBaseResult.relevance.
    const relevance = sql<number>`CASE
      WHEN ${exact} THEN 1
      WHEN ${identifierPrefix} THEN 2
      WHEN ${namePrefix} THEN 3
      ELSE 4
    END`;

    const rows = await this.db
      .select({
        agentId: tasks.assigneeAgentId,
        createdAt: tasks.createdAt,
        description: tasks.description,
        id: tasks.id,
        identifier: tasks.identifier,
        name: tasks.name,
        relevance,
        status: tasks.status,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              isDeleted: tasks.isDeleted,
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
          or(exact, identifierPrefix, ilikeContains(tasks.name, text)),
        ),
      )
      .orderBy(asc(relevance), desc(tasks.updatedAt), desc(tasks.seq))
      .limit(limit);

    return rows.map(({ name, relevance, ...row }) => ({
      ...row,
      relevance: Number(relevance),
      title: name || row.identifier,
      type: 'task' as const,
    }));
  };
}
