import { and, count, desc, eq, inArray } from 'drizzle-orm';

import type { DocumentItem, NewDocument } from '../schemas';
import { documents } from '../schemas';
import type { LobeChatDatabase } from '../type';

export interface QueryDocumentParams {
  current?: number;
  fileTypes?: string[];
  pageSize?: number;
  sourceTypes?: string[];
}

export class DocumentModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: Omit<NewDocument, 'userId'>): Promise<DocumentItem> => {
    const result = (await this.db
      .insert(documents)
      .values({ ...params, userId: this.userId })
      .returning()) as DocumentItem[];

    return result[0]!;
  };

  delete = async (id: string) => {
    return this.db
      .delete(documents)
      .where(and(eq(documents.id, id), eq(documents.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(documents).where(eq(documents.userId, this.userId));
  };

  query = async ({
    current = 0,
    pageSize = 9999,
    fileTypes,
    sourceTypes,
  }: QueryDocumentParams = {}): Promise<{
    items: DocumentItem[];
    total: number;
  }> => {
    const offset = current * pageSize;
    const conditions = [eq(documents.userId, this.userId)];

    if (fileTypes?.length) {
      conditions.push(inArray(documents.fileType, fileTypes));
    }

    if (sourceTypes?.length) {
      conditions.push(inArray(documents.sourceType, sourceTypes as ('file' | 'web' | 'api')[]));
    }

    const whereCondition = and(...conditions);

    // Fetch items and total count in parallel
    // Optimize: Exclude large JSONB fields (content, pages, editorData) for better performance
    const [rawItems, totalResult] = await Promise.all([
      this.db
        .select({
          accessedAt: documents.accessedAt,
          clientId: documents.clientId,
          createdAt: documents.createdAt,
          fileId: documents.fileId,
          fileType: documents.fileType,
          filename: documents.filename,
          id: documents.id,
          metadata: documents.metadata,
          parentId: documents.parentId,
          slug: documents.slug,
          source: documents.source,
          sourceType: documents.sourceType,
          title: documents.title,
          totalCharCount: documents.totalCharCount,
          totalLineCount: documents.totalLineCount,
          updatedAt: documents.updatedAt,
          userId: documents.userId,
          // Exclude large fields: content, pages, editorData
        })
        .from(documents)
        .where(whereCondition)
        .orderBy(desc(documents.updatedAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count(documents.id) })
        .from(documents)
        .where(whereCondition),
    ]);

    // Map to DocumentItem type with excluded fields as null
    const items = rawItems.map((item) => ({
      ...item,
      content: null,
      editorData: null,
      pages: null,
    })) as DocumentItem[];

    return { items, total: totalResult[0].count };
  };

  findById = async (id: string): Promise<DocumentItem | undefined> => {
    return this.db.query.documents.findFirst({
      where: and(eq(documents.userId, this.userId), eq(documents.id, id)),
    });
  };

  findByFileId = async (fileId: string) => {
    return this.db.query.documents.findFirst({
      where: and(eq(documents.userId, this.userId), eq(documents.fileId, fileId)),
    });
  };

  findBySlug = async (slug: string): Promise<DocumentItem | undefined> => {
    return this.db.query.documents.findFirst({
      where: and(eq(documents.userId, this.userId), eq(documents.slug, slug)),
    });
  };

  update = async (id: string, value: Partial<DocumentItem>) => {
    return this.db
      .update(documents)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(documents.userId, this.userId), eq(documents.id, id)));
  };
}
