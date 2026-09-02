import type { DocumentLikeSummary } from '@lobechat/types';
import { and, count, desc, eq } from 'drizzle-orm';

import { documentLikes } from '../schemas/documentLike';
import { documents } from '../schemas/file';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';

export const DOCUMENT_LIKE_WORKSPACE_REQUIRED =
  'Document likes are workspace-scoped; a workspaceId is required';
export const DOCUMENT_LIKE_DOCUMENT_NOT_FOUND = 'Document not found in current workspace';

/**
 * Defensive cap on liker profiles returned with a summary. Likers render as a
 * full wrapped list in the UI, and workspace membership keeps real counts far
 * below this; the cap only bounds the payload for pathological data.
 */
export const DOCUMENT_LIKE_SUMMARY_LIKERS_LIMIT = 200;

export interface LikeDocumentResult {
  /** false when the current user had already liked the document. */
  created: boolean;
  /** Author of the document; receives the like notification. */
  documentAuthorUserId: string;
  /** Post-mutation summary, read inside the same transaction. */
  summary: DocumentLikeSummary;
}

export interface UnlikeDocumentResult {
  /** Author of the document; whose like notification should be withdrawn. */
  documentAuthorUserId: string;
  /** false when the current user had not liked the document. */
  removed: boolean;
  /** Post-mutation summary, read inside the same transaction. */
  summary: DocumentLikeSummary;
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

  /**
   * Read the summary inside the caller's transaction so mutations return the
   * post-write state without opening (and locking for) a second transaction.
   * `knownLiked` skips the current-user probe when the caller just wrote it.
   */
  private summarizeInTx = async (
    tx: LobeChatDatabase,
    documentId: string,
    knownLiked?: boolean,
  ): Promise<DocumentLikeSummary> => {
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

    const liked =
      knownLiked ??
      (likers.some((liker) => liker.id === this.userId) ||
        (
          await tx
            .select({ id: documentLikes.id })
            .from(documentLikes)
            .where(
              and(eq(documentLikes.documentId, documentId), eq(documentLikes.userId, this.userId)),
            )
            .limit(1)
        ).length > 0);

    return { liked, likers, total: totals?.total ?? 0 };
  };

  async like(documentId: string): Promise<LikeDocumentResult> {
    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const document = await this.lockDocument(runner, documentId, 'update');

      const [inserted] = await tx
        .insert(documentLikes)
        .values({ documentId, userId: this.userId, workspaceId: document.workspaceId })
        .onConflictDoNothing({ target: [documentLikes.documentId, documentLikes.userId] })
        .returning({ id: documentLikes.id });

      return {
        created: Boolean(inserted),
        documentAuthorUserId: document.userId,
        summary: await this.summarizeInTx(runner, documentId, true),
      };
    });
  }

  async unlike(documentId: string): Promise<UnlikeDocumentResult> {
    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      const document = await this.lockDocument(runner, documentId, 'update');

      const removed = await tx
        .delete(documentLikes)
        .where(and(eq(documentLikes.documentId, documentId), eq(documentLikes.userId, this.userId)))
        .returning({ id: documentLikes.id });

      return {
        documentAuthorUserId: document.userId,
        removed: removed.length > 0,
        summary: await this.summarizeInTx(runner, documentId, false),
      };
    });
  }

  async summary(documentId: string): Promise<DocumentLikeSummary> {
    return this.db.transaction(async (tx) => {
      const runner = tx as LobeChatDatabase;
      // A share lock keeps the workspace validation true for the duration of
      // the reads: a concurrent transfer's UPDATE waits for this transaction.
      await this.lockDocument(runner, documentId, 'share');
      return this.summarizeInTx(runner, documentId);
    });
  }
}
