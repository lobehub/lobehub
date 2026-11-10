import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { goals } from '../schemas/goal';
import { goalNodes } from '../schemas/goalGraph';
import { acceptances } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * Thrown when a write would change an archived goal's status. Archived goals
 * are hidden from every list, so they stay put until restored.
 */
export class GoalArchivedError extends Error {
  readonly goalId: string;

  constructor(goalId: string) {
    super(`Goal is archived; restore it first with lh goal unarchive ${goalId}`);
    this.name = 'GoalArchivedError';
    this.goalId = goalId;
  }
}

/**
 * Whether the owner signed the goal off: its Goal-level acceptance Task has an
 * accepted acceptance. Correlated on `goals.id`, so it reads inside any query
 * over `goals`. Shown on list rows; archiving does not depend on it.
 */
export const goalSignedOffSql = sql<boolean>`EXISTS (
  SELECT 1 FROM ${goalNodes}
  JOIN ${acceptances}
    ON ${acceptances.subjectType} = 'task' AND ${acceptances.subjectId} = ${goalNodes.taskId}
  WHERE ${goalNodes.goalId} = ${goals.id}
    AND ${goalNodes.kind} = 'task'
    AND ${goalNodes.title} = ${GOAL_ACCEPTANCE_TASK_TITLE}
    AND ${acceptances.status} = 'accepted'
)`;

/**
 * Archive writes for `goals`, kept out of `GoalModel` the way `TaskArchiveModel`
 * is: the "completed or canceled" check is part of the UPDATE that sets
 * `archived_at`, so a resume or start racing it either lands first (and the
 * archive matches no row) or sees the archive under the row lock and refuses.
 */
export class GoalArchiveModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals);

  /**
   * Archive a goal that is completed (`achieved`) or canceled (`isGoalArchiveBlocked`).
   * Returns null when the goal is missing or not done with yet; an already
   * archived goal keeps its original `archived_at`. Only the `goals` row:
   * `GoalArchiveRepository` archives its Tasks with it.
   */
  async archive(id: string) {
    const [goal] = await this.db
      .update(goals)
      .set({ archivedAt: sql`COALESCE(${goals.archivedAt}, now())`, updatedAt: new Date() })
      .where(
        and(eq(goals.id, id), this.ownership(), inArray(goals.status, ['achieved', 'canceled'])),
      )
      .returning();
    return goal ?? null;
  }

  /** Restore an archived goal. Always allowed: it never hides work. */
  async unarchive(id: string) {
    const [goal] = await this.db
      .update(goals)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(goals.id, id), this.ownership()))
      .returning();
    return goal ?? null;
  }
}
