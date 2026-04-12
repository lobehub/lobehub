import type { KnowledgeBaseItem } from '@lobechat/types';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import type { NewKnowledgeBase } from '../schemas';
import { documents, knowledgeBaseFiles, knowledgeBases } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { FileModel } from './file';

export class KnowledgeBaseModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // create

  create = async (params: Omit<NewKnowledgeBase, 'userId'>) => {
    const [result] = await this.db
      .insert(knowledgeBases)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  };

  addFilesToKnowledgeBase = async (id: string, fileIds: string[]) => {
    // Verify the target knowledge base belongs to the current user
    const kb = await this.db.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
    });
    if (!kb) return [];

    // Separate document IDs from file IDs
    const documentIds = fileIds.filter((id) => id.startsWith('docs_'));
    const directFileIds = fileIds.filter((id) => !id.startsWith('docs_'));

    // Resolve document IDs to their mirror file IDs via documents.fileId
    let resolvedFileIds = [...directFileIds];
    if (documentIds.length > 0) {
      const docsWithFiles = await this.db
        .select({ fileId: documents.fileId })
        .from(documents)
        .where(and(inArray(documents.id, documentIds), eq(documents.userId, this.userId)));

      const mirrorFileIds = docsWithFiles
        .map((doc) => doc.fileId)
        .filter((id): id is string => id !== null);
      resolvedFileIds = [...resolvedFileIds, ...mirrorFileIds];

      // Update documents.knowledgeBaseId for pages
      await this.db
        .update(documents)
        .set({ knowledgeBaseId: id })
        .where(and(inArray(documents.id, documentIds), eq(documents.userId, this.userId)));
    }

    // Insert using resolved file IDs
    if (resolvedFileIds.length === 0) {
      return [];
    }

    return this.db
      .insert(knowledgeBaseFiles)
      .values(
        resolvedFileIds.map((fileId) => ({ fileId, knowledgeBaseId: id, userId: this.userId })),
      )
      .returning();
  };

  // delete
  delete = async (id: string) => {
    return this.db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)));
  };

  deleteAll = async () => {
    return this.db.delete(knowledgeBases).where(eq(knowledgeBases.userId, this.userId));
  };

  removeFilesFromKnowledgeBase = async (knowledgeBaseId: string, ids: string[]) => {
    // Separate document IDs from file IDs
    const documentIds = ids.filter((id) => id.startsWith('docs_'));
    const directFileIds = ids.filter((id) => !id.startsWith('docs_'));

    // Resolve document IDs to their mirror file IDs via documents.fileId
    let resolvedFileIds = [...directFileIds];
    if (documentIds.length > 0) {
      const docsWithFiles = await this.db
        .select({ fileId: documents.fileId })
        .from(documents)
        .where(and(inArray(documents.id, documentIds), eq(documents.userId, this.userId)));

      const mirrorFileIds = docsWithFiles
        .map((doc) => doc.fileId)
        .filter((id): id is string => id !== null);
      resolvedFileIds = [...resolvedFileIds, ...mirrorFileIds];

      // Clear documents.knowledgeBaseId for pages
      await this.db
        .update(documents)
        .set({ knowledgeBaseId: null })
        .where(
          and(
            inArray(documents.id, documentIds),
            eq(documents.userId, this.userId),
            eq(documents.knowledgeBaseId, knowledgeBaseId),
          ),
        );
    }

    // Delete using resolved file IDs
    if (resolvedFileIds.length === 0) {
      return;
    }

    return this.db
      .delete(knowledgeBaseFiles)
      .where(
        and(
          eq(knowledgeBaseFiles.userId, this.userId),
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          inArray(knowledgeBaseFiles.fileId, resolvedFileIds),
        ),
      );
  };
  // query
  query = async () => {
    const data = await this.db
      .select({
        avatar: knowledgeBases.avatar,
        createdAt: knowledgeBases.createdAt,
        description: knowledgeBases.description,
        id: knowledgeBases.id,
        isPublic: knowledgeBases.isPublic,
        name: knowledgeBases.name,
        settings: knowledgeBases.settings,
        type: knowledgeBases.type,
        updatedAt: knowledgeBases.updatedAt,
      })
      .from(knowledgeBases)
      .where(eq(knowledgeBases.userId, this.userId))
      .orderBy(desc(knowledgeBases.updatedAt));

    return data as KnowledgeBaseItem[];
  };

  findById = async (id: string) => {
    return this.db.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)),
    });
  };

  // update
  update = async (id: string, value: Partial<KnowledgeBaseItem>) =>
    this.db
      .update(knowledgeBases)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)));

  findExclusiveFileIds = async (knowledgeBaseId: string): Promise<string[]> => {
    const kbFiles = await this.db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(
        and(
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          eq(knowledgeBaseFiles.userId, this.userId),
        ),
      );
    const fileIds = kbFiles.map((f) => f.fileId);
    if (fileIds.length === 0) return [];

    const sharedFiles = await this.db
      .select({
        fileId: knowledgeBaseFiles.fileId,
        kbCount: count(knowledgeBaseFiles.knowledgeBaseId),
      })
      .from(knowledgeBaseFiles)
      .where(
        and(
          inArray(knowledgeBaseFiles.fileId, fileIds),
          eq(knowledgeBaseFiles.userId, this.userId),
        ),
      )
      .groupBy(knowledgeBaseFiles.fileId);

    return sharedFiles.filter((f) => Number(f.kbCount) === 1).map((f) => f.fileId);
  };

  deleteWithFiles = async (id: string, removeGlobalFile: boolean = true) => {
    const exclusiveFileIds = await this.findExclusiveFileIds(id);

    let deletedFiles: Array<{ id: string; url: string | null }> = [];
    if (exclusiveFileIds.length > 0) {
      const fileModel = new FileModel(this.db, this.userId);
      const result = await fileModel.deleteMany(exclusiveFileIds, removeGlobalFile);
      deletedFiles = (result || []).map((f) => ({ id: f.id, url: f.url }));
    }

    await this.db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, id), eq(knowledgeBases.userId, this.userId)));

    return { deletedFiles };
  };

  deleteAllWithFiles = async (removeGlobalFile: boolean = true) => {
    const allKbFileIds = await this.db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(eq(knowledgeBaseFiles.userId, this.userId));

    const fileIds = [...new Set(allKbFileIds.map((f) => f.fileId))];

    let deletedFiles: Array<{ id: string; url: string | null }> = [];
    if (fileIds.length > 0) {
      const fileModel = new FileModel(this.db, this.userId);
      const result = await fileModel.deleteMany(fileIds, removeGlobalFile);
      deletedFiles = (result || []).map((f) => ({ id: f.id, url: f.url }));
    }

    await this.db.delete(knowledgeBases).where(eq(knowledgeBases.userId, this.userId));

    return { deletedFiles };
  };

  static findById = async (db: LobeChatDatabase, id: string) =>
    db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, id),
    });
}
