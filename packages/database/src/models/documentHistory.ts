import {
  DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT,
  DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS,
} from '@lobechat/const';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';

import type { DocumentHistoryItem, NewDocumentHistory } from '../schemas';
import { documentHistories, documents } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface QueryDocumentHistoryParams {
  beforeId?: string;
  beforeSavedAt?: Date;
  documentId: string;
  limit?: number;
}

export class DocumentHistoryModel {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.db = db;
  }

  private ownership() {
    return buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      documentHistories,
    );
  }

  create = async (params: Omit<NewDocumentHistory, 'userId'>): Promise<DocumentHistoryItem> => {
    const [document] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.id, params.documentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
        ),
      )
      .limit(1);

    if (!document) {
      throw new Error('Document not found');
    }

    const [result] = await this.db
      .insert(documentHistories)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result!;
  };

  /**
   * Appends one revision to a Document the caller has already authorized.
   *
   * Use when:
   * - A unit of work resolved the Document through its owning aggregate in the same transaction.
   *
   * Expects:
   * - `documentId` is accessible to this scope; unlike {@link create}, no Document lookup runs.
   *
   * Returns:
   * - The inserted revision.
   */
  append = async (
    params: Pick<NewDocumentHistory, 'documentId' | 'editorData' | 'saveSource' | 'savedAt'>,
  ): Promise<DocumentHistoryItem> => {
    const [result] = await this.db
      .insert(documentHistories)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result!;
  };

  /**
   * Records the previous editor state as an autosave revision of an authorized Document.
   *
   * Use when:
   * - A source edit replaces Document content and the old state must stay recoverable.
   *
   * Expects:
   * - `documentId` is accessible to this scope.
   * - Autosaves coalesce into fixed clock buckets of {@link DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS}
   *   and keep at most {@link DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT} autosave rows.
   */
  recordAutosave = async (documentId: string, editorData: Record<string, any>, savedAt: Date) => {
    const [latestHistory] = await this.db
      .select()
      .from(documentHistories)
      .where(and(eq(documentHistories.documentId, documentId), this.ownership()))
      .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
      .limit(1);
    // Match the canonical Document history policy: fixed clock buckets keep
    // continuous typing bounded without turning the anchor into a sliding window.
    const withinAutosaveWindow =
      latestHistory?.saveSource === 'autosave' &&
      Math.floor(latestHistory.savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS) ===
        Math.floor(savedAt.getTime() / DOCUMENT_HISTORY_AUTOSAVE_WINDOW_MS);

    if (withinAutosaveWindow) {
      await this.db
        .update(documentHistories)
        .set({ editorData, savedAt })
        .where(and(eq(documentHistories.id, latestHistory.id), this.ownership()));
      return;
    }

    await this.append({ documentId, editorData, saveSource: 'autosave', savedAt });

    // Retain the same bounded autosave lineage as the Document service.
    const expiredAutosaves = await this.db
      .select({ id: documentHistories.id })
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.saveSource, 'autosave'),
          this.ownership(),
        ),
      )
      .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
      .offset(DOCUMENT_HISTORY_AUTOSAVE_SOURCE_LIMIT);
    if (expiredAutosaves.length > 0) {
      await this.db.delete(documentHistories).where(
        and(
          inArray(
            documentHistories.id,
            expiredAutosaves.map(({ id }) => id),
          ),
          this.ownership(),
        ),
      );
    }
  };

  delete = async (id: string) => {
    return this.db
      .delete(documentHistories)
      .where(and(eq(documentHistories.id, id), this.ownership()));
  };

  deleteByDocumentId = async (documentId: string) => {
    return this.db
      .delete(documentHistories)
      .where(and(eq(documentHistories.documentId, documentId), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(documentHistories).where(this.ownership());
  };

  findById = async (id: string): Promise<DocumentHistoryItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(documentHistories)
      .where(and(eq(documentHistories.id, id), this.ownership()))
      .limit(1);

    return result;
  };

  findLatestByDocumentId = async (documentId: string): Promise<DocumentHistoryItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(documentHistories)
      .where(and(eq(documentHistories.documentId, documentId), this.ownership()))
      .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
      .limit(1);

    return result;
  };

  list = async ({
    beforeId,
    beforeSavedAt,
    documentId,
    limit = 50,
  }: QueryDocumentHistoryParams): Promise<DocumentHistoryItem[]> => {
    const conditions = [eq(documentHistories.documentId, documentId), this.ownership()];

    if (beforeSavedAt !== undefined) {
      if (beforeId !== undefined) {
        const cursorCondition = or(
          lt(documentHistories.savedAt, beforeSavedAt),
          and(eq(documentHistories.savedAt, beforeSavedAt), lt(documentHistories.id, beforeId)),
        );
        /* v8 ignore next -- unreachable: or() over two defined conditions always returns SQL */
        if (cursorCondition) {
          conditions.push(cursorCondition);
        }
      } else {
        conditions.push(lt(documentHistories.savedAt, beforeSavedAt));
      }
    }

    return this.db
      .select()
      .from(documentHistories)
      .where(and(...conditions))
      .orderBy(desc(documentHistories.savedAt), desc(documentHistories.id))
      .limit(limit);
  };

  query = async (params: QueryDocumentHistoryParams): Promise<DocumentHistoryItem[]> => {
    return this.list(params);
  };

  listByDocumentId = async (documentId: string, limit = 50): Promise<DocumentHistoryItem[]> => {
    return this.list({ documentId, limit });
  };
}
