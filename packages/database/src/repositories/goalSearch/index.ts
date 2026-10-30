import type { GoalStatus } from '@lobechat/const/goal';
import { and, asc, desc, inArray, lte, or, sql } from 'drizzle-orm';

import { goals } from '../../schemas/goal';
import type { LobeChatDatabase } from '../../type';
import { escapeLike, ilikeContains } from '../../utils/like';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { FtsSearchGoalResult } from '../ftsSearch/types';

/** Lifecycle states after which a goal is no longer active. */
const TERMINAL_STATUSES: GoalStatus[] = ['achieved', 'failed', 'canceled'];

export interface GoalSearchOptions {
  /** Only goals created at or before this instant. */
  endDate?: Date;
  limit?: number;
  query: string;
  /** Only goals still open, or finished at or after this instant. */
  startDate?: Date;
}

/**
 * When a goal stopped being active. `GoalModel` stamps `completedAt` on every
 * terminal transition, while `updatedAt` only records the last edit — an open
 * goal untouched since before the window was still active throughout it.
 * Terminal rows that predate `completedAt` fall back to their last update.
 */
const lifetimeEnd = sql`COALESCE(${goals.completedAt}, CASE WHEN ${inArray(goals.status, TERMINAL_STATUSES)} THEN ${goals.updatedAt} END)`;

/** Open goals have no end, so they overlap every window that starts after their creation. */
const activeSince = (startDate: Date) =>
  sql<boolean>`(${lifetimeEnd} IS NULL OR ${lifetimeEnd} >= ${startDate})`;

/**
 * Lookup for goals by title or requirement.
 *
 * Goals are not part of the full-text index, so this queries the `goals` table
 * directly under the same workspace ownership as `GoalModel`, never returning
 * trashed rows. The optional window keeps goals whose lifetime overlaps it.
 */
export class GoalSearchRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  search = async ({
    endDate,
    limit = 5,
    query,
    startDate,
  }: GoalSearchOptions): Promise<FtsSearchGoalResult[]> => {
    const text = query.trim();
    if (!text || limit <= 0) return [];

    const titlePrefix = sql`${goals.title} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
    const titleContains = ilikeContains(goals.title, text);

    // Lower is better, matching FtsSearchBaseResult.relevance.
    const relevance = sql<number>`CASE
      WHEN lower(${goals.title}) = ${text.toLowerCase()} THEN 1
      WHEN ${titlePrefix} THEN 2
      WHEN ${titleContains} THEN 3
      ELSE 4
    END`;

    const rows = await this.db
      .select({
        agentId: goals.agentId,
        completedAt: goals.completedAt,
        createdAt: goals.createdAt,
        description: goals.requirement,
        id: goals.id,
        projectId: goals.projectId,
        relevance,
        status: goals.status,
        title: goals.title,
        updatedAt: goals.updatedAt,
      })
      .from(goals)
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals),
          or(titleContains, ilikeContains(goals.requirement, text)),
          startDate ? activeSince(startDate) : undefined,
          endDate ? lte(goals.createdAt, endDate) : undefined,
        ),
      )
      .orderBy(asc(relevance), desc(goals.updatedAt), desc(goals.id))
      .limit(limit);

    return rows.map(({ relevance, ...row }) => ({
      ...row,
      relevance: Number(relevance),
      type: 'goal' as const,
    }));
  };
}
