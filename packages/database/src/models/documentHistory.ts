import { and, desc, eq, lt, or } from 'drizzle-orm';

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
