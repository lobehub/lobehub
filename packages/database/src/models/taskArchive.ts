import { and, eq, inArray, ne, type SQL, sql } from 'drizzle-orm';

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
   *
   * `onlyStatuses` narrows it to tasks still in one of those statuses, checked
   * in the same UPDATE: a caller archiving from an earlier read (e.g. "this
   * task is finished") can't archive a task that was reopened since.
   */
  async archive(id: string, options: { onlyStatuses?: string[] } = {}) {
    const [task] = await this.archiveMany([id], options);
    return task ?? null;
  }

  /**
   * {@link archive} for many tasks in one guarded statement. Returns only the
   * rows that were archived; a missing or blocked task is simply absent.
   */
  async archiveMany(
    ids: string[],
    options: {
      /** The archive time to stamp instead of now — a goal archiving its Tasks shares its own. */
      at?: SQL;
      onlyStatuses?: string[];
    } = {},
  ) {
    if (ids.length === 0) return [];
    return this.db
      .update(tasks)
      .set({
        archivedAt: sql`COALESCE(${tasks.archivedAt}, ${options.at ?? sql`now()`})`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(tasks.id, ids),
          this.ownership(),
          ne(tasks.status, 'running'),
          options.onlyStatuses ? inArray(tasks.status, options.onlyStatuses) : undefined,
          // A paused schedule can't fire (dispatcher and tick skip paused);
          // a paused heartbeat still ticks, so it stays blocked.
          sql`(${RUNNABLE_AUTOMATION} AND NOT (${tasks.automationMode} = 'schedule' AND ${tasks.status} = 'paused')) IS NOT TRUE`,
        ),
      )
      .returning();
  }

  /** Restore an archived task. Always allowed: it never hides work. */
  async unarchive(id: string) {
    const [task] = await this.unarchiveMany([id]);
    return task ?? null;
  }

  /**
   * {@link unarchive} for many tasks in one statement. `onlyArchivedAt` restores
   * only the Tasks stamped with that archive time — the ones a goal archived
   * with itself — and leaves any archived on their own alone.
   */
  async unarchiveMany(ids: string[], options: { onlyArchivedAt?: SQL } = {}) {
    if (ids.length === 0) return [];
    return this.db
      .update(tasks)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          inArray(tasks.id, ids),
          this.ownership(),
          options.onlyArchivedAt ? eq(tasks.archivedAt, options.onlyArchivedAt) : undefined,
        ),
      )
      .returning();
  }
}
