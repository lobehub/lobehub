import type { QueryFileListParams } from '@lobechat/types';
import { FilesTabs, SortType } from '@lobechat/types';
import { and, asc, count, desc, eq, ilike, inArray, like, notExists, or, sum } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

import type { FileItem, NewFile, NewGlobalFile } from '../schemas';
import {
  asyncTasks,
  chunks,
  documentChunks,
  documents,
  embeddings,
  fileChunks,
  files,
  filesToSessions,
  globalFiles,
  knowledgeBaseFiles,
  messages,
  messagesFiles,
  topics,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/**
 * Minimal file descriptor used to bootstrap user-uploaded files into a sandbox.
 */
export interface SandboxInitFileItem {
  fileType: string;
  id: string;
  name: string;
  size: number;
  /** S3 key / storage url, needs to be turned into a download url before use */
  url: string;
}

export class FileModel {
  private readonly userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files);

  /**
   * Get file by ID without userId filter (public access)
   * Use this for scenarios like file proxy where file should be accessible by ID alone
   *
   * @param db - Database instance
   * @param id - File ID
   * @returns File record or undefined
   */
  static async getFileById(db: LobeChatDatabase, id: string): Promise<FileItem | undefined> {
    return db.query.files.findFirst({
      where: eq(files.id, id),
    });
  }

  create = async (
    params: Omit<NewFile, 'id' | 'userId'> & {
      id?: string;
      knowledgeBaseId?: string;
      parentId?: string;
    },
    insertToGlobalFiles?: boolean,
    trx?: Transaction,
  ): Promise<{ id: string }> => {
    const executeInTransaction = async (tx: Transaction): Promise<FileItem> => {
      if (insertToGlobalFiles) {
        await tx
          .insert(globalFiles)
          .values({
            creator: this.userId,
            fileType: params.fileType,
            hashId: params.fileHash!,
            metadata: params.metadata,
            size: params.size,
            url: params.url,
          })
          .onConflictDoNothing();
      }

      const result = (await tx
        .insert(files)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { ...params },
          ),
        )
        .returning()) as FileItem[];

      const item = result[0]!;

      if (params.knowledgeBaseId) {
        await tx.insert(knowledgeBaseFiles).values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              fileId: item.id,
              knowledgeBaseId: params.knowledgeBaseId,
            },
          ),
        );
      }

      return item;
    };

    const result = await (trx
      ? executeInTransaction(trx)
      : this.db.transaction(executeInTransaction));
    return { id: result.id };
  };

  createGlobalFile = async (file: Omit<NewGlobalFile, 'id' | 'userId'>) => {
    return this.db.insert(globalFiles).values(file).returning();
  };

  updateGlobalFile = async (
    hashId: string,
    data: Partial<Pick<NewGlobalFile, 'metadata' | 'url'>>,
    trx?: Transaction,
  ) => {
    return (trx ?? this.db).update(globalFiles).set(data).where(eq(globalFiles.hashId, hashId));
  };

  checkHash = async (hash: string) => {
    const item = await this.db.query.globalFiles.findFirst({
      where: eq(globalFiles.hashId, hash),
    });
    if (!item) return { isExist: false };

    return {
      fileType: item.fileType,
      isExist: true,
      metadata: item.metadata,
      size: item.size,
      url: item.url,
    };
  };

  delete = async (id: string, removeGlobalFile: boolean = true, trx?: Transaction) => {
    const executeInTransaction = async (tx: Transaction) => {
      // In pglite environment, non-transactional operations cannot be used within a transaction as it will block
      const file = await this.findById(id, tx);
      if (!file) return;

      const fileHash = file.fileHash;

      // 1. Delete related chunks
      await this.deleteFileChunks(tx as any, [id]);

      // 2. Delete mirror documents whose source is this file. Without this,
      // documents.fileId would be set null by FK and leave orphan rows behind
      // (still indexed by BM25, still occupying KB slots).
      await tx
        .delete(documents)
        .where(
          and(
            eq(documents.fileId, id),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
            eq(documents.sourceType, 'file'),
          ),
        );

      // 3. Delete the chunk/embedding asyncTasks tied to this file. files.chunkTaskId
      // and embeddingTaskId are `set null` on the asyncTasks side, so without this
      // the task rows would dangle in the DB forever.
      const taskIds = [file.chunkTaskId, file.embeddingTaskId].filter((taskId): taskId is string =>
        Boolean(taskId),
      );
      if (taskIds.length > 0) {
        await tx.delete(asyncTasks).where(inArray(asyncTasks.id, taskIds));
      }

      // 4. Delete file record
      await tx.delete(files).where(and(eq(files.id, id), this.ownership()));

      if (!fileHash) return;

      const result = await tx
        .select({ count: count() })
        .from(files)
        .where(eq(files.fileHash, fileHash));

      const fileCount = result[0].count;

      // delete the file from global file if it is not used by other files
      // if `DISABLE_REMOVE_GLOBAL_FILE` is true, we will not remove the global file
      if (fileCount === 0 && removeGlobalFile) {
        await tx.delete(globalFiles).where(eq(globalFiles.hashId, fileHash));

        return file;
      }
    };

    return await (trx ? executeInTransaction(trx) : this.db.transaction(executeInTransaction));
  };

  deleteGlobalFile = async (hashId: string) => {
    return this.db.delete(globalFiles).where(eq(globalFiles.hashId, hashId));
  };

  countUsage = async (trx?: Transaction) => {
    const db = trx ?? this.db;
    const result = await db
      .select({
        totalSize: sum(files.size),
      })
      .from(files)
      .where(this.ownership());

    return parseInt(result[0].totalSize!) || 0;
  };

  deleteMany = async (ids: string[], removeGlobalFile: boolean = true) => {
    if (ids.length === 0) return [];

    return await this.db.transaction(async (trx) => {
      // 1. First get the file list to return the deleted files
      const fileList = await trx.query.files.findMany({
        where: and(inArray(files.id, ids), this.ownership()),
      });

      if (fileList.length === 0) return [];

      // Extract file hashes that need to be checked
      const hashList = fileList.map((file) => file.fileHash!).filter(Boolean);

      // 2. Delete related chunks
      await this.deleteFileChunks(trx as any, ids);

      // 3. Delete mirror documents (sourceType='file') so they don't linger as
      // orphans with fileId set to null after the file row is removed.
      await trx
        .delete(documents)
        .where(
          and(
            inArray(documents.fileId, ids),
            buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
            eq(documents.sourceType, 'file'),
          ),
        );

      // 4. Delete chunk/embedding asyncTasks attached to these files.
      const taskIds = fileList
        .flatMap((file) => [file.chunkTaskId, file.embeddingTaskId])
        .filter((taskId): taskId is string => Boolean(taskId));
      if (taskIds.length > 0) {
        await trx.delete(asyncTasks).where(inArray(asyncTasks.id, taskIds));
      }

      // 5. Delete file records
      await trx.delete(files).where(and(inArray(files.id, ids), this.ownership()));

      // If global files don't need to be deleted, no storage object should be removed.
      if (!removeGlobalFile || hashList.length === 0) return [];

      // 4. Find hashes that are no longer referenced
      const remainingFiles = await trx
        .select({
          fileHash: files.fileHash,
        })
        .from(files)
        .where(inArray(files.fileHash, hashList));

      // Put still-in-use hashes into a Set for quick lookup
      const usedHashes = new Set(remainingFiles.map((file) => file.fileHash));

      // Find hashes to delete (those no longer used by any file)
      const hashesToDelete = hashList.filter((hash) => !usedHashes.has(hash));

      if (hashesToDelete.length === 0) return [];

      // 5. Delete global files that are no longer referenced
      await trx.delete(globalFiles).where(inArray(globalFiles.hashId, hashesToDelete));

      const hashesToDeleteSet = new Set(hashesToDelete);

      // Return only files whose backing global object became unreferenced.
      return fileList.filter((file) => file.fileHash && hashesToDeleteSet.has(file.fileHash));
    });
  };

  clear = async () => {
    return this.db.delete(files).where(this.ownership());
  };

  query = async ({
    category,
    q,
    sortType,
    sorter,
    knowledgeBaseId,
    showFilesInKnowledgeBase,
  }: QueryFileListParams = {}) => {
    // 1. Build where clause
    let whereClause = and(q ? ilike(files.name, `%${q}%`) : undefined, this.ownership());
    if (category && category !== FilesTabs.All && category !== FilesTabs.Home) {
      const fileTypePrefix = this.getFileTypePrefix(category as FilesTabs);
      if (Array.isArray(fileTypePrefix)) {
        // For multiple file types (e.g., Documents includes 'application' and 'custom')
        whereClause = and(
          whereClause,
          or(...fileTypePrefix.map((prefix) => ilike(files.fileType, `${prefix}%`))),
        );
      } else {
        whereClause = and(whereClause, ilike(files.fileType, `${fileTypePrefix}%`));
      }
    }

    // 2. Build order clause

    let orderByClause = desc(files.createdAt);
    // create a map for sortable fields
    const sortableFields = {
      createdAt: files.createdAt,
      name: files.name,
      size: files.size,
      updatedAt: files.updatedAt,
    } as const;
    type SortableField = keyof typeof sortableFields;

    if (sorter && sortType && sorter in sortableFields) {
      const sortFunction = sortType.toLowerCase() === SortType.Asc ? asc : desc;
      orderByClause = sortFunction(sortableFields[sorter as SortableField]);
    }

    // 3. Build base query
    let query = this.db
      .select({
        chunkTaskId: files.chunkTaskId,
        createdAt: files.createdAt,
        embeddingTaskId: files.embeddingTaskId,
        fileType: files.fileType,
        id: files.id,
        name: files.name,
        size: files.size,
        updatedAt: files.updatedAt,
        url: files.url,
        userId: files.userId,
      })
      .from(files);

    // 4. Add knowledge base query if needed
    if (knowledgeBaseId) {
      // if knowledgeBaseId is provided, it means we are querying files in a knowledge-base

      // @ts-ignore
      query = query.innerJoin(
        knowledgeBaseFiles,
        and(
          eq(files.id, knowledgeBaseFiles.fileId),
          eq(knowledgeBaseFiles.knowledgeBaseId, knowledgeBaseId),
        ),
      );
    }
    // 5. If we don't show files in knowledge base, exclude them
    else if (!showFilesInKnowledgeBase) {
      whereClause = and(
        whereClause,
        notExists(
          this.db.select().from(knowledgeBaseFiles).where(eq(knowledgeBaseFiles.fileId, files.id)),
        ),
      );
    }

    // Otherwise, we are just filtering in the global files
    return query.where(whereClause).orderBy(orderByClause);
  };

  findByIds = async (ids: string[]) => {
    return this.db.query.files.findMany({
      where: and(inArray(files.id, ids), this.ownership()),
    });
  };

  findById = async (id: string, trx?: Transaction) => {
    const database = trx || this.db;
    return database.query.files.findFirst({
      where: and(eq(files.id, id), this.ownership()),
    });
  };

  /**
   * Collect the user-uploaded files that should be pre-loaded into a sandbox for
   * the given topic. Combines two associations and de-duplicates by file id:
   * - files attached to messages inside the topic (`messages_files`)
   * - files attached to the session that owns the topic (`files_to_sessions`)
   */
  findFilesToInitInSandbox = async (topicId: string): Promise<SandboxInitFileItem[]> => {
    const columns = {
      fileType: files.fileType,
      id: files.id,
      name: files.name,
      size: files.size,
      url: files.url,
    };

    const [messageFiles, sessionFiles] = await Promise.all([
      this.db
        .select(columns)
        .from(messagesFiles)
        .innerJoin(messages, eq(messagesFiles.messageId, messages.id))
        .innerJoin(files, eq(messagesFiles.fileId, files.id))
        .where(and(eq(messages.topicId, topicId), eq(messagesFiles.userId, this.userId))),
      this.db
        .select(columns)
        .from(filesToSessions)
        .innerJoin(topics, eq(topics.sessionId, filesToSessions.sessionId))
        .innerJoin(files, eq(filesToSessions.fileId, files.id))
        .where(and(eq(topics.id, topicId), eq(filesToSessions.userId, this.userId))),
    ]);

    const deduped = new Map<string, SandboxInitFileItem>();
    for (const file of [...messageFiles, ...sessionFiles]) {
      if (!deduped.has(file.id)) deduped.set(file.id, file);
    }

    return [...deduped.values()];
  };

  countFilesByHash = async (hash: string) => {
    const result = await this.db
      .select({
        count: count(),
      })
      .from(files)
      .where(and(eq(files.fileHash, hash)));

    return result[0].count;
  };

  update = async (id: string, value: Partial<FileItem>) =>
    this.db
      .update(files)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(files.id, id), this.ownership()));

  /**
   * get the corresponding file type prefix according to FilesTabs
   */
  private getFileTypePrefix = (category: FilesTabs): string | string[] => {
    switch (category) {
      case FilesTabs.Audios: {
        return 'audio';
      }
      case FilesTabs.Documents: {
        return ['application', 'custom'];
      }
      case FilesTabs.Images: {
        return 'image';
      }
      case FilesTabs.Videos: {
        return 'video';
      }
      case FilesTabs.Websites: {
        return 'text/html';
      }
      default: {
        return '';
      }
    }
  };

  findByNames = async (fileNames: string[]) =>
    this.db.query.files.findMany({
      where: and(or(...fileNames.map((name) => like(files.name, `${name}%`))), this.ownership()),
    });

  // Abstract common method for deleting chunks
  private deleteFileChunks = async (trx: PgTransaction<any>, fileIds: string[]) => {
    if (fileIds.length === 0) return;

    // Get all chunk IDs related to the files to be deleted (knowledge base protection logic removed)
    const relatedChunks = await trx
      .select({ chunkId: fileChunks.chunkId })
      .from(fileChunks)
      .where(inArray(fileChunks.fileId, fileIds));

    const chunkIds = relatedChunks.map((c) => c.chunkId).filter(Boolean) as string[];

    if (chunkIds.length === 0) return;

    // Batch processing configuration
    const BATCH_SIZE = 1000;
    const MAX_CONCURRENT_BATCHES = 3;

    // Process in batches concurrently
    for (let i = 0; i < chunkIds.length; i += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
      const batchPromises = [];

      // Create multiple parallel batches
      for (let j = 0; j < MAX_CONCURRENT_BATCHES; j++) {
        const startIdx = i + j * BATCH_SIZE;
        if (startIdx >= chunkIds.length) break;

        const batchChunkIds = chunkIds.slice(startIdx, startIdx + BATCH_SIZE);
        if (batchChunkIds.length === 0) continue;

        // Process each batch in the correct deletion order.
        const batchPromise = (async () => {
          await trx.delete(embeddings).where(inArray(embeddings.chunkId, batchChunkIds));
          await trx.delete(documentChunks).where(inArray(documentChunks.chunkId, batchChunkIds));
          await trx.delete(chunks).where(inArray(chunks.id, batchChunkIds));
        })();

        batchPromises.push(batchPromise);
      }

      // Wait for all tasks in the current batch to complete
      await Promise.all(batchPromises);
    }

    // 4. Finally delete fileChunks association table records
    await trx.delete(fileChunks).where(inArray(fileChunks.fileId, fileIds));

    return chunkIds;
  };

  // ========== Transfer / Copy ==========

  /**
   * Transfer a single file (not a folder — folders live in `documents` and are
   * handled by `DocumentModel.transferTo`, which already cascades into `files`
   * via `parentId`). Updates ownership + knowledgeBaseFiles linkage so the
   * file remains visible in the target scope's resource manager.
   */
  transferTo = async (
    fileId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ fileId: string }> => {
    return this.db.transaction(async (trx) => {
      const file = await trx.query.files.findFirst({
        where: and(eq(files.id, fileId), this.ownership()),
      });
      if (!file) throw new Error('File not found');

      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };

      await trx
        .update(files)
        .set({ ...ownershipUpdate, updatedAt: new Date() })
        .where(eq(files.id, fileId));

      // Knowledge base links are scoped per-user; keep them pointed at the new owner.
      await trx
        .update(knowledgeBaseFiles)
        .set({ userId: targetUserId })
        .where(eq(knowledgeBaseFiles.fileId, fileId));

      return { fileId };
    });
  };

  /**
   * Clone a file record into another workspace / personal scope. The physical
   * blob is shared via `fileHash` → `globalFiles`, so we only copy the row. AI
   * index references (`chunkTaskId` / `embeddingTaskId`) are reset; the new
   * scope is expected to re-index lazily.
   */
  copyToWorkspace = async (
    fileId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<{ fileId: string }> => {
    return this.db.transaction(async (trx) => {
      const file = await trx.query.files.findFirst({
        where: and(eq(files.id, fileId), this.ownership()),
      });
      if (!file) throw new Error('File not found');

      const inserted = (await trx
        .insert(files)
        .values({
          chunkTaskId: null,
          clientId: null,
          embeddingTaskId: null,
          fileHash: file.fileHash,
          fileType: file.fileType,
          metadata: { ...(file.metadata as Record<string, unknown>), duplicatedFrom: file.id },
          name: file.name,
          // parentId would dangle in target scope; the user can drag it under a folder later.
          parentId: null,
          size: file.size,
          source: file.source,
          url: file.url,
          userId: targetUserId,
          workspaceId: targetWorkspaceId,
        } as NewFile)
        .returning({ id: files.id })) as { id: string }[];

      return { fileId: inserted[0]!.id };
    });
  };
}
