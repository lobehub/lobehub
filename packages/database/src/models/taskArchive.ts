import { and, eq, ne, sql } from 'drizzle-orm';

import { tasks } from '../schemas/task';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';
import { RUNNABLE_AUTOMATION } from './taskListFilters';

/**
 * Archive writes for `tasks`. Kept out of `TaskModel` so the guard lives in one
 * statement: archiving checks "not running, no live automation" in the same
 * UPDATE that sets `archived_at`, so a run or schedule starting concurrently
 * either lands first (and the archive matches no row) or sees the archive.
 */
export class TaskArchiveModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        isDeleted: tasks.isDeleted,
        userId: tasks.createdByUserId,
        visibility: tasks.visibility,
        workspaceId: tasks.workspaceId,
      },
    );

  /**
   * Archive a task unless it is running or its schedule / heartbeat can still
   * fire (mirrors `isTaskArchiveBlocked` in `@lobechat/types`). Returns null when the task is missing or blocked; an already archived
   * task keeps its original `archived_at`.
   */
  async archive(id: string) {
    const [task] = await this.db
      .update(tasks)
      .set({ archivedAt: sql`COALESCE(${tasks.archivedAt}, now())`, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, id),
          this.ownership(),
          ne(tasks.status, 'running'),
          // A paused schedule can't fire (dispatcher and tick skip paused);
          // a paused heartbeat still ticks, so it stays blocked.
          sql`(${RUNNABLE_AUTOMATION} AND NOT (${tasks.automationMode} = 'schedule' AND ${tasks.status} = 'paused')) IS NOT TRUE`,
        ),
      )
      .returning();
    return task ?? null;
  }

  /** Restore an archived task. Always allowed: it never hides work. */
  async unarchive(id: string) {
    const [task] = await this.db
      .update(tasks)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()))
      .returning();
    return task ?? null;
  }
}
