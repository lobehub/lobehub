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

  private findDocument = async (documentId: string) => {
    const workspaceId = this.requireWorkspaceId();
    const [document] = await this.db
      .select({ id: documents.id, userId: documents.userId, workspaceId: documents.workspaceId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!document || document.workspaceId !== workspaceId) {
      throw new Error(DOCUMENT_LIKE_DOCUMENT_NOT_FOUND);
    }
    return { ...document, workspaceId };
  };

  async like(documentId: string): Promise<LikeDocumentResult> {
    const workspaceId = this.requireWorkspaceId();

    return this.db.transaction(async (tx) => {
      // Lock the document row so a like serializes against a concurrent scope
      // transfer (whose UPDATE holds this row lock until commit): the stamped
      // workspaceId is re-validated after the transfer lands, and a stale-scope
      // like fails instead of surviving in the source workspace. Mirrors
      // DocumentCommentModel.create.
      const [locked] = await tx
        .select({ id: documents.id, userId: documents.userId, workspaceId: documents.workspaceId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
        .for('update');
      if (!locked || locked.workspaceId !== workspaceId) {
        throw new Error(DOCUMENT_LIKE_DOCUMENT_NOT_FOUND);
      }

      const [inserted] = await tx
        .insert(documentLikes)
        .values({ documentId, userId: this.userId, workspaceId })
        .onConflictDoNothing({ target: [documentLikes.documentId, documentLikes.userId] })
        .returning({ id: documentLikes.id });

      return { created: Boolean(inserted), documentAuthorUserId: locked.userId };
    });
  }

  async unlike(documentId: string): Promise<UnlikeDocumentResult> {
    const document = await this.findDocument(documentId);

    const removed = await this.db
      .delete(documentLikes)
      .where(and(eq(documentLikes.documentId, documentId), eq(documentLikes.userId, this.userId)))
      .returning({ id: documentLikes.id });

    return { documentAuthorUserId: document.userId, removed: removed.length > 0 };
  }

  async summary(documentId: string): Promise<DocumentLikeSummary> {
    await this.findDocument(documentId);

    const [[totals], likers] = await Promise.all([
      this.db
        .select({ total: count() })
        .from(documentLikes)
        .where(eq(documentLikes.documentId, documentId)),
      this.db
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
          await this.db
            .select({ id: documentLikes.id })
            .from(documentLikes)
            .where(
              and(eq(documentLikes.documentId, documentId), eq(documentLikes.userId, this.userId)),
            )
            .limit(1)
        ).length > 0;

    return { liked, likers, total: totals?.total ?? 0 };
  }
}
