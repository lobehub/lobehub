import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { GoalModel } from '../../models/goal';
import { GoalArchiveModel } from '../../models/goalArchive';
import { TaskArchiveModel } from '../../models/taskArchive';
import { goals } from '../../schemas/goal';
import { goalNodes } from '../../schemas/goalGraph';
import type { LobeChatDatabase } from '../../type';

/**
 * A goal and the Tasks its graph dispatched are put away and brought back
 * together. Both directions run in one transaction and lock the goal row
 * before any Task, so concurrent archive / unarchive calls queue on the goal
 * instead of deadlocking on each other's rows.
 */
export class GoalArchiveRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

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

  /** The goal's own archive time, read in SQL so its Tasks share it to the microsecond. */
  private goalArchivedAt = (goalId: string) =>
    sql`(SELECT ${goals.archivedAt} FROM ${goals} WHERE ${goals.id} = ${goalId})`;

  /**
   * Archive a completed or canceled goal and its Tasks. The goal's UPDATE
   * takes its row lock first. The Tasks go through the guarded task archive,
   * so one still running or with a live schedule / heartbeat stays where its
   * owner can see it, and they carry the goal's own archive time, which is how
   * {@link unarchive} tells them from Tasks archived on their own. Returns null
   * when the goal is missing or not done with yet.
   */
  archive = async (id: string) =>
    this.db.transaction(async (tx) => {
      const goal = await new GoalArchiveModel(tx, this.userId, this.workspaceId).archive(id);
      if (!goal) return null;
      await new TaskArchiveModel(tx, this.userId, this.workspaceId).archiveMany(
        await this.graphTaskIds(tx, id),
        { at: this.goalArchivedAt(id) },
      );
      return goal;
    });

  /**
   * Restore a goal and the Tasks archived with it; a Task archived on its own
   * stays archived. Locks the goal row first, the same order as {@link archive}.
   */
  unarchive = async (id: string) =>
    this.db.transaction(async (tx) => {
      if (!(await new GoalModel(tx, this.userId, this.workspaceId).lockById(id))) return null;
      // Before the goal's own stamp is cleared — it is what names its Tasks.
      await new TaskArchiveModel(tx, this.userId, this.workspaceId).unarchiveMany(
        await this.graphTaskIds(tx, id),
        { onlyArchivedAt: this.goalArchivedAt(id) },
      );
      return new GoalArchiveModel(tx, this.userId, this.workspaceId).unarchive(id);
    });
}
