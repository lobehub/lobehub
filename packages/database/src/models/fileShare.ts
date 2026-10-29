import type { ShareVisibility } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';

import { files, fileShares } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { notTrashed } from '../utils/softDelete';
import { buildWorkspaceWhere } from '../utils/workspace';

export type FileShareData = NonNullable<
  Awaited<ReturnType<(typeof FileShareModel)['findByShareId']>>
>;

export class FileShareModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  // file_shares.visibility is share semantics ('private' | 'link'), not the
  // workspace row-visibility ('public' | 'private') — pass only the scope
  // columns so buildWorkspaceWhere never filters on it.
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: fileShares.userId, workspaceId: fileShares.workspaceId },
    );

  /**
   * Create or get existing share for a file.
   * Each file can only have one share record (enforced by unique constraint).
   * If record already exists, returns the existing one.
   */
  create = async (fileId: string, visibility: ShareVisibility = 'private') => {
    // First verify the file belongs to the user (or workspace).
    const [file] = await this.db
      .select({ userId: files.userId })
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
        ),
      )
      .limit(1);

    if (!file) {
      throw new Error('File not found or not owned by user');
    }

    const [result] = await this.db
      .insert(fileShares)
      .values({
        fileId,
        // Keep the file creator as the share owner even when a workspace
        // admin manages the share — downstream access checks treat this
        // column as ownerId for private-share visibility.
        userId: file.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing({ target: fileShares.fileId })
      .returning();

    // If conflict occurred, return existing record
    if (!result) {
      return this.getByFileId(fileId);
    }

    return result;
  };

  /**
   * Update share visibility
   */
  updateVisibility = async (fileId: string, visibility: ShareVisibility) => {
    const [result] = await this.db
      .update(fileShares)
      .set({ updatedAt: new Date(), visibility })
      .where(and(eq(fileShares.fileId, fileId), this.ownership()))
      .returning();

    return result || null;
  };

  /**
   * Delete a share by file ID
   */
  deleteByFileId = async (fileId: string) => {
    return this.db.delete(fileShares).where(and(eq(fileShares.fileId, fileId), this.ownership()));
  };

  /**
   * Get share info by file ID (for the owner)
   */
  getByFileId = async (fileId: string) => {
    const result = await this.db
      .select({
        fileId: fileShares.fileId,
        id: fileShares.id,
        pageViewCount: fileShares.pageViewCount,
        userId: fileShares.userId,
        visibility: fileShares.visibility,
      })
      .from(fileShares)
      .where(and(eq(fileShares.fileId, fileId), this.ownership()))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Find shared file by share ID.
   * Returns share info including ownerId for permission checking by caller.
   */
  static findByShareId = async (db: LobeChatDatabase, shareId: string) => {
    const result = await db
      .select({
        fileId: files.id,
        fileType: files.fileType,
        name: files.name,
        ownerId: fileShares.userId,
        pageViewCount: fileShares.pageViewCount,
        shareId: fileShares.id,
        size: files.size,
        url: files.url,
        visibility: fileShares.visibility,
        workspaceId: fileShares.workspaceId,
      })
      .from(fileShares)
      // A share is resolved with no user scope at all (that is the point of a
      // public link), so it never passes through `buildWorkspaceWhere` and has
      // to carry the recycle-bin gate itself: a trashed file keeps its
      // `file_shares` row until purge, and without this an anonymous visitor
      // could keep reading a deleted file.
      .innerJoin(files, and(eq(fileShares.fileId, files.id), notTrashed(files.isDeleted)))
      .where(eq(fileShares.id, shareId))
      .limit(1);

    return result[0] || null;
  };

  /**
   * Increment page view count for a share.
   * Should be called after permission check passes.
   */
  static incrementViewCount = async (db: LobeChatDatabase, shareId: string) => {
    await db
      .update(fileShares)
      .set({ pageViewCount: sql`${fileShares.pageViewCount} + 1` })
      .where(eq(fileShares.id, shareId));
  };

  /**
   * Find shared file by share ID with visibility check.
   * Throws TRPCError if access is denied.
   */
  static findByShareIdWithAccessCheck = async (
    db: LobeChatDatabase,
    shareId: string,
    accessUserId?: string,
  ): Promise<FileShareData> => {
    const share = await FileShareModel.findByShareId(db, shareId);

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
