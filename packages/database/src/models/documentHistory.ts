import { and, desc, eq, lt, or } from 'drizzle-orm';

import type { DocumentHistoryItem, NewDocumentHistory } from '../schemas';
import { documentHistories, documents } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface QueryDocumentHistoryParams {
  beforeId?: string;
  beforeSavedAt?: Date;
  documentId: string;
  limit?: number;
}

export class DocumentHistoryModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewDocumentHistory, 'userId'>): Promise<DocumentHistoryItem> => {
    const [document] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, params.documentId), eq(documents.userId, this.userId)))
      .limit(1);

    if (!document) {
      throw new Error('Document not found');
    }

    const [result] = await this.db
      .insert(documentHistories)
      .values({ ...params, userId: this.userId })
      .returning();

    return result!;
  };

  delete = async (id: string) => {
    return this.db
      .delete(documentHistories)
      .where(and(eq(documentHistories.id, id), eq(documentHistories.userId, this.userId)));
  };

  deleteByDocumentId = async (documentId: string) => {
    return this.db
      .delete(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.userId, this.userId),
        ),
      );
  };

  deleteAll = async () => {
    return this.db.delete(documentHistories).where(eq(documentHistories.userId, this.userId));
  };

  findById = async (id: string): Promise<DocumentHistoryItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(documentHistories)
      .where(and(eq(documentHistories.id, id), eq(documentHistories.userId, this.userId)))
      .limit(1);

    return result;
  };

  findLatestByDocumentId = async (documentId: string): Promise<DocumentHistoryItem | undefined> => {
    const [result] = await this.db
      .select()
      .from(documentHistories)
      .where(
        and(
          eq(documentHistories.documentId, documentId),
          eq(documentHistories.userId, this.userId),
        ),
      )
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
    const conditions = [
      eq(documentHistories.documentId, documentId),
      eq(documentHistories.userId, this.userId),
    ];

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
