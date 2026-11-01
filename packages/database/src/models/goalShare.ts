import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';

import { goals, goalShares } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';
import { buildWorkspaceWhere } from '../utils/workspace';

export type GoalShareData = NonNullable<
  Awaited<ReturnType<(typeof GoalShareModel)['findByShareId']>>
>;

export class GoalShareModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  // goal_shares.visibility is share semantics ('private' | 'link'), not the
  // workspace row-visibility ('public' | 'private') — pass only the scope
  // columns so buildWorkspaceWhere never filters on it.
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: goalShares.userId, workspaceId: goalShares.workspaceId },
    );

  /**
   * Create or get existing share for a goal.
   * Each goal can only have one share record (enforced by unique constraint).
   * If record already exists, returns the existing one.
   */
  create = async (goalId: string, visibility: ShareVisibility = 'private') => {
    // First verify the goal belongs to the user (or workspace).
    const [goal] = await this.db
      .select({ userId: goals.userId })
      .from(goals)
      .where(
        and(
          eq(goals.id, goalId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals),
        ),
      )
      .limit(1);

    if (!goal) {
      throw new Error('Goal not found or not owned by user');
    }

    const [result] = await this.db
      .insert(goalShares)
      .values({
        goalId,
        // Keep the goal creator as the share owner even when a workspace
        // admin manages the share — downstream access checks treat this
        // column as ownerId for private-share visibility.
        userId: goal.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing({ target: goalShares.goalId })
      .returning();

    // If conflict occurred, return existing record
    if (!result) {
      return this.getByGoalId(goalId);
    }

    return result;
  };

  /**
   * Update share visibility
   */
  updateVisibility = async (goalId: string, visibility: ShareVisibility) => {
    const [result] = await this.db
      .update(goalShares)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(goalShares.goalId, goalId), this.ownership()))
      .returning();

    return result || null;
  };

  /**
   * Delete a share by goal ID
   */
  deleteByGoalId = async (goalId: string) => {
    return this.db.delete(goalShares).where(and(eq(goalShares.goalId, goalId), this.ownership()));
  };

  /**
   * Get share info by goal ID (for the owner)
   */
  getByGoalId = async (goalId: string) => {
    const result = await this.db
      .select({
        goalId: goalShares.goalId,
        id: goalShares.id,
        pageViewCount: goalShares.pageViewCount,
        userId: goalShares.userId,
        visibility: goalShares.visibility,
      })
      .from(goalShares)
      .where(and(eq(goalShares.goalId, goalId), this.ownership()))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Find shared goal by share ID.
   * Returns share info including ownerId for permission checking by caller.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    const result = await db
      .select({
        goalId: goals.id,
        ownerId: goalShares.userId,
        pageViewCount: goalShares.pageViewCount,
        shareId: goalShares.id,
        title: goals.title,
        visibility: goalShares.visibility,
        workspaceId: goalShares.workspaceId,
      })
      .from(goalShares)
      // A share is resolved with no user scope at all (that is the point of a
      // public link), so it never passes through `buildWorkspaceWhere` and has
      // to carry the recycle-bin gate itself: a trashed goal keeps its
      // `goal_shares` row until purge, and without this an anonymous visitor
      // could keep reading a deleted goal.
      .innerJoin(goals, and(eq(goalShares.goalId, goals.id), notTrashed(goals.isDeleted)))
      .where(eq(goalShares.id, shareId))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Increment page view count for a share.
   * Should be called after permission check passes.
   */
  static incrementViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(goalShares)
      .set({ pageViewCount: sql`${goalShares.pageViewCount} + 1` })
      .where(eq(goalShares.id, shareId));
  };

  /**
   * Find shared goal by share ID with visibility check.
   * Throws TRPCError if access is denied.
   */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId?: string,
  ): Promise<GoalShareData> => {
    const share = await GoalShareModel.findByShareId(db, shareId);

    if (!share) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
    }

    const isOwner = !!accessUserId && share.ownerId === accessUserId;

    // 'private' - only the share creator can view, even inside a workspace
    // 'link' - anyone with the link can view
    if (!isOwner && share.visibility === 'private') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This share is private' });
    }

    return share;
  };
}
