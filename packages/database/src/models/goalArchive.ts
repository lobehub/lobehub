import { GOAL_ARCHIVABLE_STATUSES } from '@lobechat/types';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { goals } from '../schemas/goal';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * Archive writes for `goals`, kept out of `GoalModel` the way `TaskArchiveModel`
 * is: the "nothing can still move" check is part of the UPDATE that sets
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
   * Archive a goal that is a draft or has ended (`isGoalArchiveBlocked`).
   * Returns null when the goal is missing or still able to move; an already
   * archived goal keeps its original `archived_at`.
   */
  async archive(id: string) {
    const [goal] = await this.db
      .update(goals)
      .set({ archivedAt: sql`COALESCE(${goals.archivedAt}, now())`, updatedAt: new Date() })
      .where(
        and(
          eq(goals.id, id),
          this.ownership(),
          inArray(goals.status, [...GOAL_ARCHIVABLE_STATUSES]),
        ),
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
