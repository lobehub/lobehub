import type { DocumentLikeSummary } from '@lobechat/types';
import { and, count, desc, eq } from 'drizzle-orm';

import { documentLikes } from '../schemas/documentLike';
import { documents } from '../schemas/file';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export const DOCUMENT_LIKE_WORKSPACE_REQUIRED =
  'Document likes are workspace-scoped; a workspaceId is required';
export const DOCUMENT_LIKE_DOCUMENT_NOT_FOUND = 'Document not found in current workspace';

/** Number of liker profiles returned with a summary. */
export const DOCUMENT_LIKE_SUMMARY_LIKERS_LIMIT = 20;

export interface LikeDocumentResult {
  /** false when the current user had already liked the document. */
  created: boolean;
  /** Author of the document; receives the like notification. */
  documentAuthorUserId: string;
}

export interface UnlikeDocumentResult {
  /** Author of the document; whose like notification should be withdrawn. */
  documentAuthorUserId: string;
  /** false when the current user had not liked the document. */
  removed: boolean;
}

export class DocumentLikeModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string | null;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string | null) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private requireWorkspaceId = (): string => {
    if (!this.workspaceId) throw new Error(DOCUMENT_LIKE_WORKSPACE_REQUIRED);
    return this.workspaceId;
  };

  /**
   * Validate the document inside the caller's transaction while holding a row
   * lock, so every like operation serializes against a concurrent scope
   * transfer (whose UPDATE holds this row lock until commit): writes take
   * `for update`, reads take `for share`, and a stale-scope caller fails after
   * the transfer lands instead of acting on rehomed rows. Mirrors
   * DocumentCommentModel.create.
   */
  private lockDocument = async (
    tx: LobeChatDatabase,
    documentId: string,
    mode: 'share' | 'update',
  ) => {
    const workspaceId = this.requireWorkspaceId();
    const [document] = await tx
      .select({ id: documents.id, userId: documents.userId, workspaceId: documents.workspaceId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1)
      .for(mode);

    if (!document || document.workspaceId !== workspaceId) {
      throw new Error(DOCUMENT_LIKE_DOCUMENT_NOT_FOUND);
    }
    return { ...document, workspaceId };
  };

  async like(documentId: string): Promise<LikeDocumentResult> {
    return this.db.transaction(async (tx) => {
      const document = await this.lockDocument(tx as LobeChatDatabase, documentId, 'update');

      const [inserted] = await tx
        .insert(documentLikes)
        .values({ documentId, userId: this.userId, workspaceId: document.workspaceId })
        .onConflictDoNothing({ target: [documentLikes.documentId, documentLikes.userId] })
        .returning({ id: documentLikes.id });

      return { created: Boolean(inserted), documentAuthorUserId: document.userId };
    });
  }

  async unlike(documentId: string): Promise<UnlikeDocumentResult> {
    return this.db.transaction(async (tx) => {
      const document = await this.lockDocument(tx as LobeChatDatabase, documentId, 'update');

      const removed = await tx
        .delete(documentLikes)
        .where(and(eq(documentLikes.documentId, documentId), eq(documentLikes.userId, this.userId)))
        .returning({ id: documentLikes.id });

      return { documentAuthorUserId: document.userId, removed: removed.length > 0 };
    });
  }

  async summary(documentId: string): Promise<DocumentLikeSummary> {
    return this.db.transaction(async (tx) => {
      // A share lock keeps the workspace validation true for the duration of
      // the reads: a concurrent transfer's UPDATE waits for this transaction.
      await this.lockDocument(tx as LobeChatDatabase, documentId, 'share');

      const [[totals], likers] = await Promise.all([
        tx
          .select({ total: count() })
          .from(documentLikes)
          .where(eq(documentLikes.documentId, documentId)),
        tx
          .select({
            avatar: users.avatar,
            fullName: users.fullName,
            id: users.id,
            username: users.username,
          })
          .from(documentLikes)
          .innerJoin(users, eq(users.id, documentLikes.userId))
          .where(eq(documentLikes.documentId, documentId))
          .orderBy(desc(documentLikes.createdAt), desc(documentLikes.id))
          .limit(DOCUMENT_LIKE_SUMMARY_LIKERS_LIMIT),
      ]);

      const liked = likers.some((liker) => liker.id === this.userId)
        ? true
        : (
            await tx
              .select({ id: documentLikes.id })
              .from(documentLikes)
              .where(
                and(
                  eq(documentLikes.documentId, documentId),
                  eq(documentLikes.userId, this.userId),
                ),
              )
              .limit(1)
          ).length > 0;

      return { liked, likers, total: totals?.total ?? 0 };
    });
  }
}
