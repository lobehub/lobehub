import { and, eq, exists, sql } from 'drizzle-orm';

import { goalNodes, goals, topics } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * Whether the outer `topics` row is the conversation a goal was planned in —
 * the same set the composer's linked-goal tray lists (`GoalModel.list` with
 * `topicId`): bound through `subject_type = 'topic'`, owned by the caller, not
 * trashed, and carrying a graph. One `goals_subject_idx` probe per row.
 *
 * Built with the query builder so the correlated columns render fully
 * qualified; a bare `sql` template renders `topics.id` as `"id"`, which the
 * inner FROM resolves to `goals.id` and never matches.
 */
export const topicHasGoal = (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
) => {
  const linkedGoal = db
    .select({ value: sql`1` })
    .from(goals)
    .where(
      and(
        eq(goals.subjectType, 'topic'),
        eq(goals.subjectId, topics.id),
        buildWorkspaceWhere(scope, goals),
        exists(
          db
            .select({ value: sql`1` })
            .from(goalNodes)
            .where(eq(goalNodes.goalId, goals.id)),
        ),
      ),
    );

  return sql<boolean>`EXISTS (${linkedGoal})`.mapWith(Boolean);
};
