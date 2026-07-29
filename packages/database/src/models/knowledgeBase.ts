import type { KnowledgeBaseItem } from '@lobechat/types';
import { and, count, desc, eq, inArray, ne, or, sum } from 'drizzle-orm';

import type { NewDocument, NewFile, NewKnowledgeBase } from '../schemas';
import { documents, files, knowledgeBaseFiles, knowledgeBases } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { FileModel } from './file';

export class KnowledgeBaseModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = (callerAgentVisibility?: 'private' | 'public' | null) =>
    buildWorkspaceWhere(
      { callerAgentVisibility, userId: this.userId, workspaceId: this.workspaceId },
      knowledgeBases,
    );

  // create

  create = async (params: Omit<NewKnowledgeBase, 'userId'>) => {
    const [result] = await this.db
      .insert(knowledgeBases)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params },
        ),
      )
      .returning();

    return result;
  };

  addFilesToKnowledgeBase = async (id: string, fileIds: string[]) => {
    // Verify the target knowledge base belongs to the current user
    const kb = await this.db.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, id), this.ownership()),
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
        .where(
          and(
            inArray(documents.id, documentIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          ),
        );

      const mirrorFileIds = docsWithFiles
        .map((doc) => doc.fileId)
        .filter((id): id is string => id !== null);
      resolvedFileIds = [...resolvedFileIds, ...mirrorFileIds];

      // Update documents.knowledgeBaseId for pages
      await this.db
        .update(documents)
        .set({ knowledgeBaseId: id })
        .where(
          and(
            inArray(documents.id, documentIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          ),
        );
    }

    // Insert using resolved file IDs
    if (resolvedFileIds.length === 0) {
      return [];
    }

    return this.db
      .insert(knowledgeBaseFiles)
      .values(
        resolvedFileIds.map((fileId) => ({
          fileId,
          knowledgeBaseId: id,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      )
      .returning();
  };

  // delete
  delete = async (id: string) => {
    return this.db.delete(knowledgeBases).where(and(eq(knowledgeBases.id, id), this.ownership()));
  };

  deleteAll = async () => {
    return this.db.delete(knowledgeBases).where(this.ownership());
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
        .where(
          and(
            inArray(documents.id, documentIds),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
          ),
        );

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
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
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
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBaseFiles,
          ),
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          inArray(knowledgeBaseFiles.fileId, resolvedFileIds),
        ),
      );
  };
  // query
  query = async (options?: {
    callerAgentVisibility?: 'private' | 'public' | null;
    visibility?: 'private' | 'public';
  }) => {
    const ownershipWhere = this.ownership(options?.callerAgentVisibility);
    const conditions = options?.visibility
      ? and(ownershipWhere, eq(knowledgeBases.visibility, options.visibility))
      : ownershipWhere;

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
        userId: knowledgeBases.userId,
        visibility: knowledgeBases.visibility,
      })
      .from(knowledgeBases)
      .where(conditions)
      .orderBy(desc(knowledgeBases.updatedAt));

    return data as KnowledgeBaseItem[];
  };

  findById = async (id: string) => {
    return this.db.query.knowledgeBases.findFirst({
      where: and(eq(knowledgeBases.id, id), this.ownership()),
    });
  };

  countFileUsage = async (id: string): Promise<number> => {
    const result = await this.db
      .select({ totalSize: sum(files.size) })
      .from(knowledgeBaseFiles)
      .innerJoin(files, eq(files.id, knowledgeBaseFiles.fileId))
      .where(
        and(
          eq(knowledgeBaseFiles.knowledgeBaseId, id),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBaseFiles,
          ),
        ),
      );

    return parseInt(result[0]?.totalSize ?? '0') || 0;
  };

  // update
  update = async (id: string, value: Partial<KnowledgeBaseItem>) =>
    this.db
      .update(knowledgeBases)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(knowledgeBases.id, id), this.ownership()));

  /**
   * Publish a private knowledge base into the workspace. Thin wrapper around
   * `setVisibility(id, 'public')`; kept as a named method for the TRPC
   * `publishKnowledgeBaseToWorkspace` procedure and existing callers.
   */
  publishToWorkspace = async (id: string) => this.setVisibility(id, 'public');

  /**
   * Flip a knowledge base's `visibility`. Bidirectional companion to
   * `publishToWorkspace`. The combined `user_id = ?` +
   * `visibility = fromVisibility` guards keep the operation creator-only and
   * idempotent against rows already at the target visibility.
   *
   * Unpublishing is safe by design — this column only gates KB list
   * enumeration; other members lose the sidebar entry immediately, while
   * downstream RAG paths handle a missing/unreachable KB.
   */
  setVisibility = async (id: string, visibility: 'private' | 'public') => {
    const fromVisibility = visibility === 'public' ? 'private' : 'public';

    return this.db
      .update(knowledgeBases)
      .set({ updatedAt: new Date(), visibility })
      .where(
        and(
          eq(knowledgeBases.id, id),
          this.ownership(),
          eq(knowledgeBases.userId, this.userId),
          eq(knowledgeBases.visibility, fromVisibility),
        ),
      );
  };

  private resolveAvailableName = async (
    db: LobeChatDatabase,
    name: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    excludeId?: string,
  ): Promise<string> => {
    const existingKnowledgeBases = await db
      .select({ id: knowledgeBases.id, name: knowledgeBases.name })
      .from(knowledgeBases)
      .where(
        buildWorkspaceWhere(
          { userId: targetUserId, workspaceId: targetWorkspaceId ?? undefined },
          knowledgeBases,
        ),
      );
    const existingNames = new Set(
      existingKnowledgeBases
        .filter((knowledgeBase) => knowledgeBase.id !== excludeId)
        .map((knowledgeBase) => knowledgeBase.name),
    );

    if (!existingNames.has(name)) return name;

    let index = 1;
    let candidate = `${name} (${index})`;
    while (existingNames.has(candidate)) {
      index += 1;
      candidate = `${name} (${index})`;
    }

    return candidate;
  };

  /**
   * Whether the KB's cascade (linked files + derived documents) contains rows
   * created by someone else. Transfers rehome every cascaded row, so non-owner
   * members must not move a KB that carries teammates' content.
   */
  hasForeignLinkedRows = async (id: string): Promise<boolean> => {
    const fileLinks = await this.db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(eq(knowledgeBaseFiles.knowledgeBaseId, id));
    const fileIds = fileLinks.map((link) => link.fileId);

    if (fileIds.length > 0) {
      const [foreignFile] = await this.db
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, fileIds), ne(files.userId, this.userId)))
        .limit(1);
      if (foreignFile) return true;
    }

    const documentWhere =
      fileIds.length > 0
        ? or(eq(documents.knowledgeBaseId, id), inArray(documents.fileId, fileIds))
        : eq(documents.knowledgeBaseId, id);
    const [foreignDoc] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(documentWhere, ne(documents.userId, this.userId)))
      .limit(1);
    return !!foreignDoc;
  };

  transferTo = async (
    id: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ id: string }> => {
    return this.db.transaction(async (trx) => {
      const [knowledgeBase] = await trx
        .select()
        .from(knowledgeBases)
        .where(and(eq(knowledgeBases.id, id), this.ownership()))
        .limit(1);
      if (!knowledgeBase) throw new Error('Knowledge base not found');

      const fileLinks = await trx
        .select({ fileId: knowledgeBaseFiles.fileId })
        .from(knowledgeBaseFiles)
        .where(eq(knowledgeBaseFiles.knowledgeBaseId, id));
      const fileIds = fileLinks.map((item) => item.fileId);
      const now = new Date();
      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };
      // Visibility only applies when landing in a workspace — personal scope
      // treats every row as implicitly private.
      const visibilityUpdate =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};
      const targetName = await this.resolveAvailableName(
        trx as LobeChatDatabase,
        knowledgeBase.name,
        targetWorkspaceId,
        targetUserId,
        id,
      );

      await trx
        .update(knowledgeBases)
        .set({ ...ownershipUpdate, ...visibilityUpdate, name: targetName, updatedAt: now })
        .where(eq(knowledgeBases.id, id));

      await trx
        .update(knowledgeBaseFiles)
        .set(ownershipUpdate)
        .where(eq(knowledgeBaseFiles.knowledgeBaseId, id));

      if (fileIds.length > 0) {
        await trx
          .update(files)
          .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: now })
          .where(inArray(files.id, fileIds));
      }

      const documentWhere =
        fileIds.length > 0
          ? or(eq(documents.knowledgeBaseId, id), inArray(documents.fileId, fileIds))
          : eq(documents.knowledgeBaseId, id);

      await trx
        .update(documents)
        .set({ ...ownershipUpdate, ...visibilityUpdate, updatedAt: now })
        .where(documentWhere);

      return { id };
    });
  };

  copyToWorkspace = async (
    id: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ id: string }> => {
    return this.db.transaction(async (trx) => {
      const [knowledgeBase] = await trx
        .select()
        .from(knowledgeBases)
        .where(and(eq(knowledgeBases.id, id), this.ownership()))
        .limit(1);
      if (!knowledgeBase) throw new Error('Knowledge base not found');
      // Visibility only applies when landing in a workspace.
      const visibilityOverride =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};
      const targetName = await this.resolveAvailableName(
        trx as LobeChatDatabase,
        knowledgeBase.name,
        targetWorkspaceId,
        targetUserId,
      );

      const [copiedKnowledgeBase] = await trx
        .insert(knowledgeBases)
        .values({
          avatar: knowledgeBase.avatar,
          description: knowledgeBase.description,
          isPublic: knowledgeBase.isPublic,
          name: targetName,
          settings: knowledgeBase.settings,
          type: knowledgeBase.type,
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
          ...visibilityOverride,
        } as NewKnowledgeBase)
        .returning();

      const fileLinks = await trx
        .select({ fileId: knowledgeBaseFiles.fileId })
        .from(knowledgeBaseFiles)
        .where(eq(knowledgeBaseFiles.knowledgeBaseId, id));
      const fileIds = fileLinks.map((item) => item.fileId);

      const documentWhere =
        fileIds.length > 0
          ? or(eq(documents.knowledgeBaseId, id), inArray(documents.fileId, fileIds))
          : eq(documents.knowledgeBaseId, id);
      const sourceDocuments = await trx.select().from(documents).where(documentWhere);
      const sourceDocumentIds = new Set(sourceDocuments.map((item) => item.id));
      const documentIdMap = new Map<string, string>();
      let pendingDocuments = [...sourceDocuments];

      while (pendingDocuments.length > 0) {
        const readyDocuments = pendingDocuments.filter(
          (document) =>
            !document.parentId ||
            !sourceDocumentIds.has(document.parentId) ||
            documentIdMap.has(document.parentId),
        );
        const documentsToCopy = readyDocuments.length > 0 ? readyDocuments : pendingDocuments;

        for (const document of documentsToCopy) {
          const metadata =
            document.metadata && typeof document.metadata === 'object'
              ? { ...document.metadata, duplicatedFrom: document.id }
              : { duplicatedFrom: document.id };
          const [copiedDocument] = await trx
            .insert(documents)
            .values({
              clientId: null,
              content: document.content,
              description: document.description,
              editorData: document.editorData,
              fileId: null,
              fileType: document.fileType,
              filename: document.filename,
              knowledgeBaseId:
                document.knowledgeBaseId === id ? copiedKnowledgeBase.id : document.knowledgeBaseId,
              metadata,
              pages: document.pages,
              parentId: document.parentId ? (documentIdMap.get(document.parentId) ?? null) : null,
              source: document.source,
              sourceType: document.sourceType,
              title: document.title,
              totalCharCount: document.totalCharCount,
              totalLineCount: document.totalLineCount,
              userId: targetUserId,
              workspaceId: targetWorkspaceId,
              ...visibilityOverride,
            } as NewDocument)
            .returning({ id: documents.id });

          documentIdMap.set(document.id, copiedDocument.id);
        }

        const copiedIds = new Set(documentsToCopy.map((document) => document.id));
        pendingDocuments = pendingDocuments.filter((document) => !copiedIds.has(document.id));
      }

      const fileIdMap = new Map<string, string>();
      if (fileIds.length > 0) {
        const sourceFiles = await trx.select().from(files).where(inArray(files.id, fileIds));

        for (const file of sourceFiles) {
          const metadata =
            file.metadata && typeof file.metadata === 'object'
              ? { ...file.metadata, duplicatedFrom: file.id }
              : { duplicatedFrom: file.id };
          const [copiedFile] = await trx
            .insert(files)
            .values({
              chunkTaskId: null,
              clientId: null,
              embeddingTaskId: null,
              fileHash: file.fileHash,
              fileType: file.fileType,
              metadata,
              name: file.name,
              parentId: file.parentId ? (documentIdMap.get(file.parentId) ?? null) : null,
              size: file.size,
              source: file.source,
              url: file.url,
              userId: targetUserId,
              workspaceId: targetWorkspaceId,
              ...visibilityOverride,
            } as NewFile)
            .returning({ id: files.id });

          fileIdMap.set(file.id, copiedFile.id);
        }

        const copiedLinks = fileLinks.flatMap((link) => {
          const fileId = fileIdMap.get(link.fileId);
          if (!fileId) return [];

          return [
            {
              fileId,
              knowledgeBaseId: copiedKnowledgeBase.id,
              userId: targetUserId,
              workspaceId: targetWorkspaceId,
            },
          ];
        });

        if (copiedLinks.length > 0) {
          await trx.insert(knowledgeBaseFiles).values(copiedLinks);
        }
      }

      for (const document of sourceDocuments) {
        if (!document.fileId) continue;

        const copiedDocumentId = documentIdMap.get(document.id);
        const copiedFileId = fileIdMap.get(document.fileId);
        if (!copiedDocumentId || !copiedFileId) continue;

        await trx
          .update(documents)
          .set({ fileId: copiedFileId })
          .where(eq(documents.id, copiedDocumentId));
      }

      return { id: copiedKnowledgeBase.id };
    });
  };

  findExclusiveFileIds = async (knowledgeBaseId: string): Promise<string[]> => {
    const kbFiles = await this.db
      .select({ fileId: knowledgeBaseFiles.fileId })
      .from(knowledgeBaseFiles)
      .where(
        and(
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBaseFiles,
          ),
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
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBaseFiles,
          ),
        ),
      )
      .groupBy(knowledgeBaseFiles.fileId);

    return sharedFiles.filter((f) => Number(f.kbCount) === 1).map((f) => f.fileId);
  };

  deleteWithFiles = async (
    id: string,
    removeGlobalFile: boolean = true,
    options?: { restrictToCreator?: boolean },
  ) => {
    const exclusiveFileIds = await this.findExclusiveFileIds(id);

    let deletedFiles: Array<{ id: string; url: string | null }> = [];
    if (exclusiveFileIds.length > 0) {
      const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
      // Teammate-owned files can be linked into this KB; a non-owner member's
      // delete must not take those file records/storage with it.
      const result = await fileModel.deleteMany(exclusiveFileIds, removeGlobalFile, {
        restrictToCreator: options?.restrictToCreator,
      });
      deletedFiles = (result || []).map((f) => ({ id: f.id, url: f.url }));
    }

    await this.db.delete(knowledgeBases).where(and(eq(knowledgeBases.id, id), this.ownership()));

    return { deletedFiles };
  };

  deleteAllWithFiles = async (
    removeGlobalFile: boolean = true,
    options?: { restrictToCreator?: boolean },
  ) => {
    // Workspace clear-all from non-owner members only removes the caller's own KBs.
    const kbWhere = options?.restrictToCreator
      ? and(this.ownership(), eq(knowledgeBases.userId, this.userId))
      : this.ownership();

    const allKbLinks = await this.db
      .select({
        fileId: knowledgeBaseFiles.fileId,
        knowledgeBaseId: knowledgeBaseFiles.knowledgeBaseId,
      })
      .from(knowledgeBaseFiles)
      .where(
        buildWorkspaceWhere(
          { userId: this.userId, workspaceId: this.workspaceId },
          knowledgeBaseFiles,
        ),
      );

    let fileIds = [...new Set(allKbLinks.map((f) => f.fileId))];

    if (options?.restrictToCreator) {
      const targetKbs = await this.db
        .select({ id: knowledgeBases.id })
        .from(knowledgeBases)
        .where(kbWhere);
      const targetKbIds = new Set(targetKbs.map((kb) => kb.id));

      // Files still linked to a surviving KB must outlive the narrowed clear-all.
      const survivingFileIds = new Set(
        allKbLinks
          .filter((link) => !targetKbIds.has(link.knowledgeBaseId))
          .map((link) => link.fileId),
      );

      fileIds = [
        ...new Set(
          allKbLinks
            .filter(
              (link) => targetKbIds.has(link.knowledgeBaseId) && !survivingFileIds.has(link.fileId),
            )
            .map((link) => link.fileId),
        ),
      ];
    }

    let deletedFiles: Array<{ id: string; url: string | null }> = [];
    if (fileIds.length > 0) {
      const fileModel = new FileModel(this.db, this.userId, this.workspaceId);
      // Teammate-owned files can be linked into the caller's KBs; a narrowed
      // clear-all must not take those file records/storage with it.
      const result = await fileModel.deleteMany(fileIds, removeGlobalFile, {
        restrictToCreator: options?.restrictToCreator,
      });
      deletedFiles = (result || []).map((f) => ({ id: f.id, url: f.url }));
    }

    await this.db.delete(knowledgeBases).where(kbWhere);

    return { deletedFiles };
  };

  static findById = async (db: LobeChatDatabase, id: string) =>
    db.query.knowledgeBases.findFirst({
      where: eq(knowledgeBases.id, id),
    });
}
