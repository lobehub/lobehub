import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';

import { goals } from '../schemas/goal';
import { goalNodes } from '../schemas/goalGraph';
import { acceptances } from '../schemas/verify';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';
import { TaskArchiveModel } from './taskArchive';

/**
 * Thrown when a write would move an archived goal back into a status in which
 * it can move on its own (`isGoalStatusInMotion`). Archived goals are hidden
 * from every list, so they stay put until restored.
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
 * over `goals`.
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
 * is: the "signed off or canceled" check is part of the UPDATE that sets
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

  /** The Tasks the goal's graph dispatched. */
  private graphTaskIds = async (db: LobeChatDatabase, goalId: string) => {
    const rows = await db
      .selectDistinct({ taskId: goalNodes.taskId })
      .from(goalNodes)
      .where(
        and(eq(goalNodes.goalId, goalId), eq(goalNodes.kind, 'task'), isNotNull(goalNodes.taskId)),
      );
    return rows.flatMap((row) => (row.taskId ? [row.taskId] : []));
  };

  /** The goal's own archive time, read in SQL so the Tasks share it to the microsecond. */
  private goalArchivedAt = (goalId: string) =>
    sql`(SELECT ${goals.archivedAt} FROM ${goals} WHERE ${goals.id} = ${goalId})`;

  /**
   * Archive a goal that is signed off or canceled (`isGoalArchiveBlocked`), and
   * its graph's Tasks with it. Returns null when the goal is missing or not
   * done with yet; an already archived goal keeps its original `archived_at`.
   *
   * The Tasks go through the guarded task archive, so one still running or
   * with a live schedule / heartbeat stays where its owner can see it. They are
   * stamped with the goal's own archive time, which is how {@link unarchive}
   * tells them from Tasks archived on their own.
   */
  async archive(id: string) {
    return this.db.transaction(async (tx) => {
      const [goal] = await tx
        .update(goals)
        .set({ archivedAt: sql`COALESCE(${goals.archivedAt}, now())`, updatedAt: new Date() })
        .where(
          and(
            eq(goals.id, id),
            this.ownership(),
            or(eq(goals.status, 'canceled'), and(eq(goals.status, 'achieved'), goalSignedOffSql)),
          ),
        )
        .returning();
      if (!goal) return null;

      await new TaskArchiveModel(tx, this.userId, this.workspaceId).archiveMany(
        await this.graphTaskIds(tx, id),
        { at: this.goalArchivedAt(id) },
      );
      return goal;
    });
  }

  /**
   * Restore an archived goal, and the Tasks archived with it. Always allowed:
   * it never hides work. A Task archived on its own stays archived.
   */
  async unarchive(id: string) {
    return this.db.transaction(async (tx) => {
      // Before the goal's own stamp is cleared — it is what names its Tasks.
      await new TaskArchiveModel(tx, this.userId, this.workspaceId).unarchiveMany(
        await this.graphTaskIds(tx, id),
        { onlyArchivedAt: this.goalArchivedAt(id) },
      );
      const [goal] = await tx
        .update(goals)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(goals.id, id), this.ownership()))
        .returning();
      return goal ?? null;
    });
  }
}
