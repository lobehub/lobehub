import {
  CUSTOM_DOCUMENT_FILE_TYPE,
  CUSTOM_FOLDER_FILE_TYPE,
  DERIVED_DOCUMENT_SOURCE_TYPE,
} from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  businessFileTransferStorageCheck,
  businessFileUploadCheck,
} from '@/business/server/lambda-routers/file';
import { checkFileStorageUsage } from '@/business/server/trpc-middlewares/lambda';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { serverDBEnv } from '@/config/db';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { workspaceMembers } from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus, AsyncTaskType, type IAsyncTaskError } from '@/types/asyncTask';
import type { FileListItem, KnowledgeItemStatus } from '@/types/files';
import { QueryFileListSchema, UploadFileSchema } from '@/types/files';
import { TransferErrorCode } from '@/types/transferError';

/**
 * Generate file proxy URL
 * Returns a unified proxy URL format: ${APP_URL}/f/:id
 */
const getFileProxyUrl = (fileId: string): string => `${appEnv.APP_URL}/f/${fileId}`;
const fileTransferEntityTypeSchema = z.enum(['document', 'file', 'folder']);

const filterKnowledgeItems = <
  T extends {
    fileType: string;
    sourceType: string;
  },
>(
  items: T[],
  knowledgeBaseId?: string,
) => {
  return !knowledgeBaseId
    ? items.filter(
        (item) =>
          !(
            item.sourceType === DERIVED_DOCUMENT_SOURCE_TYPE &&
            item.fileType === CUSTOM_FOLDER_FILE_TYPE
          ),
      )
    : items;
};

const getKnowledgeItemStatusMap = async (
  ctx: {
    asyncTaskModel: AsyncTaskModel;
    chunkModel: ChunkModel;
  },
  fileItems: Array<{
    chunkTaskId?: string | null;
    embeddingTaskId?: string | null;
    id: string;
  }>,
): Promise<Map<string, KnowledgeItemStatus>> => {
  if (fileItems.length === 0) return new Map();

  const fileIds = fileItems.map((item) => item.id);
  const chunkTaskIds = [
    ...new Set(fileItems.map((item) => item.chunkTaskId).filter(Boolean)),
  ] as string[];
  const embeddingTaskIds = [
    ...new Set(fileItems.map((item) => item.embeddingTaskId).filter(Boolean)),
  ] as string[];

  const [chunks, chunkTasks, embeddingTasks] = await Promise.all([
    ctx.chunkModel.countByFileIds(fileIds),
    chunkTaskIds.length > 0
      ? ctx.asyncTaskModel.findByIds(chunkTaskIds, AsyncTaskType.Chunking)
      : Promise.resolve([]),
    embeddingTaskIds.length > 0
      ? ctx.asyncTaskModel.findByIds(embeddingTaskIds, AsyncTaskType.Embedding)
      : Promise.resolve([]),
  ]);

  const chunkRows = chunks ?? [];
  const chunkTaskRows = chunkTasks ?? [];
  const embeddingTaskRows = embeddingTasks ?? [];

  const chunkCountMap = new Map(
    chunkRows.filter((item) => item.id).map((item) => [item.id, item.count] as const),
  );
  const chunkTaskMap = new Map(chunkTaskRows.map((task) => [task.id, task] as const));
  const embeddingTaskMap = new Map(embeddingTaskRows.map((task) => [task.id, task] as const));

  return new Map(
    fileItems.map((item) => {
      const chunkTask = item.chunkTaskId ? chunkTaskMap.get(item.chunkTaskId) : null;
      const embeddingTask = item.embeddingTaskId
        ? embeddingTaskMap.get(item.embeddingTaskId)
        : null;

      return [
        item.id,
        {
          chunkCount: chunkCountMap.get(item.id) ?? null,
          chunkingError: (chunkTask?.error as IAsyncTaskError | null | undefined) ?? null,
          chunkingStatus: (chunkTask?.status as AsyncTaskStatus | null | undefined) ?? null,
          embeddingError: (embeddingTask?.error as IAsyncTaskError | null | undefined) ?? null,
          embeddingStatus: (embeddingTask?.status as AsyncTaskStatus | null | undefined) ?? null,
          finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
          id: item.id,
        },
      ] as const;
    }),
  );
};

const isStoredObjectAvailable = async (fileService: FileService, url: string): Promise<boolean> => {
  try {
    // Hash records can outlive their backing object, for example when generated
    // assets are cleaned up but the global hash row remains. Treat stale rows as
    // missing so the client uploads a fresh copy instead of reusing a dead key.
    await fileService.getFileMetadata(url);
    return true;
  } catch (error) {
    console.error('Failed to verify existing file hash storage object:', error);
    return false;
  }
};

const fileProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId, wsId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId, wsId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId, wsId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId, wsId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      knowledgeRepo: new KnowledgeRepo(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const fileRouter = router({
  checkFileHash: fileProcedure
    .use(withScopedPermission('file:upload'))
    .use(checkFileStorageUsage)
    .input(z.object({ hash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existingFile = await ctx.fileModel.checkHash(input.hash);
      const existingHashUrl = existingFile?.isExist ? existingFile.url : undefined;
      if (!existingHashUrl) return existingFile;

      const isStorageAvailable = await isStoredObjectAvailable(ctx.fileService, existingHashUrl);

      return isStorageAvailable ? existingFile : { isExist: false };
    }),

  createFile: fileProcedure
    .use(withScopedPermission('file:upload'))
    .use(checkFileStorageUsage)
    .input(
      UploadFileSchema.omit({ url: true }).extend({
        parentId: z.string().optional(),
        url: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingFile = await ctx.fileModel.checkHash(input.hash!);
      const { isExist } = existingFile;

      // Resolve parentId if it's a slug
      let resolvedParentId = input.parentId;
      if (input.parentId) {
        const docBySlug = await ctx.documentModel.findBySlug(input.parentId);
        if (docBySlug) {
          resolvedParentId = docBySlug.id;
        }
      }

      let actualSize = input.size;
      try {
        const { contentLength } = await ctx.fileService.getFileMetadata(input.url);
        if (contentLength >= 1) {
          actualSize = contentLength;
        }
      } catch {
        // If metadata fetch fails, use original size from input
      }

      if (actualSize < 0) {
        await businessFileUploadCheck({
          actualSize,
          clientIp: ctx.clientIp ?? undefined,
          inputSize: input.size,
          url: input.url,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File size cannot be negative' });
      }

      const { id } = await ctx.serverDB.transaction(async (trx) => {
        await businessFileUploadCheck({
          actualSize,
          clientIp: ctx.clientIp ?? undefined,
          inputSize: input.size,
          transaction: trx,
          url: input.url,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        let shouldRefreshGlobalFile = false;
        if (isExist && existingFile.url && existingFile.url !== input.url) {
          shouldRefreshGlobalFile = !(await isStoredObjectAvailable(
            ctx.fileService,
            existingFile.url,
          ));
        }

        if (shouldRefreshGlobalFile) {
          // A user may re-upload the same bytes after the old object key was
          // removed. Keep the global hash pointer on the newly uploaded object so
          // future dedup checks do not resolve back to the stale key.
          await ctx.fileModel.updateGlobalFile(
            input.hash!,
            {
              metadata: input.metadata,
              url: input.url,
            },
            trx,
          );
        }

        return ctx.fileModel.create(
          {
            fileHash: input.hash,
            fileType: input.fileType,
            knowledgeBaseId: input.knowledgeBaseId,
            metadata: input.metadata,
            name: input.name,
            parentId: resolvedParentId,
            size: actualSize,
            url: input.url,
          },
          // if the file is not exist in global file, create a new one
          !isExist,
          trx,
        );
      });

      return { id, url: await ctx.fileService.getFileAccessUrl({ id, url: input.url }) };
    }),
  findById: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.fileModel.findById(input.id);
      if (!item) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });

      return {
        chunkTaskId: item.chunkTaskId,
        clientId: item.clientId,
        createdAt: item.createdAt,
        embeddingTaskId: item.embeddingTaskId,
        fileHash: item.fileHash,
        fileType: item.fileType,
        id: item.id,
        metadata: item.metadata,
        name: item.name,
        parentId: item.parentId,
        size: item.size,
        source: item.source,
        updatedAt: item.updatedAt,
        url: await ctx.fileService.getFileAccessUrl(item),
        userId: item.userId,
      };
    }),

  getFileItemById: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }): Promise<FileListItem | undefined> => {
      const item = await ctx.fileModel.findById(input.id);

      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });

      const statusMap = await getKnowledgeItemStatusMap(ctx, [item]);
      const status = statusMap.get(item.id)!;

      return {
        createdAt: item.createdAt,
        chunkCount: status.chunkCount ?? null,
        chunkingError: status.chunkingError,
        chunkingStatus: status.chunkingStatus,
        embeddingError: status.embeddingError,
        embeddingStatus: status.embeddingStatus,
        fileType: item.fileType,
        finishEmbedding: status.finishEmbedding ?? false,
        id: item.id,
        metadata: item.metadata as Record<string, any> | null | undefined,
        name: item.name,
        size: item.size,
        sourceType: 'file' as const,
        updatedAt: item.updatedAt,
        url: await ctx.fileService.getFileAccessUrl(item),
      };
    }),

  getFiles: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    const fileList = await ctx.fileModel.query(input);
    const statusMap = await getKnowledgeItemStatusMap(ctx, fileList);

    const resultFiles = [] as any[];
    for (const item of fileList as any[]) {
      const status = statusMap.get(item.id)!;
      const fileItem = {
        ...item,
        sourceType: 'file' as const,
        url: await ctx.fileService.getFileAccessUrl(item),
        ...status,
      } as FileListItem;
      resultFiles.push(fileItem);
    }

    return resultFiles;
  }),

  getKnowledgeItemStatusesByIds: fileProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
      }),
    )
    .query(async ({ ctx, input }): Promise<KnowledgeItemStatus[]> => {
      const ids = [...new Set(input.ids)];
      if (ids.length === 0) return [];

      const fileItems = await ctx.fileModel.findByIds(ids);
      const statusMap = await getKnowledgeItemStatusMap(ctx, fileItems);

      return ids.flatMap((id) => {
        const status = statusMap.get(id);
        return status ? [status] : [];
      });
    }),

  getKnowledgeItems: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    // Request one more item than limit to check if there are more items
    const limit = input.limit ?? 50;
    const knowledgeItems = await ctx.knowledgeRepo.query({
      ...input,
      limit: limit + 1,
    });

    // Check if there are more items
    const hasMore = knowledgeItems.length > limit;

    // Take only the requested number of items
    const itemsToProcess = hasMore ? knowledgeItems.slice(0, limit) : knowledgeItems;

    // Filter out folders from Documents category when in Inbox (no knowledgeBaseId)
    const filteredItems = filterKnowledgeItems(itemsToProcess, input.knowledgeBaseId);

    // Process files (add chunk info and async task status)
    const fileItems = filteredItems.filter((item) => item.sourceType === 'file');
    const statusMap = await getKnowledgeItemStatusMap(ctx, fileItems);

    // Combine all items with their metadata
    const resultItems = [] as any[];
    for (const item of filteredItems) {
      if (item.sourceType === 'file') {
        const status = statusMap.get(item.id)!;
        resultItems.push({
          ...item,
          editorData: null,
          url: await ctx.fileService.getFileAccessUrl(item),
          ...status,
        } as FileListItem);
      } else {
        // Document item - no chunk processing needed, includes editorData
        const documentItem = {
          ...item,
          chunkCount: null,
          chunkingError: null,
          chunkingStatus: null,
          embeddingError: null,
          embeddingStatus: null,
          finishEmbedding: false,
        } as FileListItem;
        resultItems.push(documentItem);
      }
    }

    return {
      hasMore,
      items: resultItems,
    };
  }),

  resolveKnowledgeItemIds: fileProcedure
    .input(QueryFileListSchema)
    .query(async ({ ctx, input }): Promise<{ ids: string[]; total: number }> => {
      const ids: string[] = [];
      const batchSize = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const knowledgeItems = await ctx.knowledgeRepo.query({
          ...input,
          limit: batchSize + 1,
          offset,
        });

        const currentHasMore = knowledgeItems.length > batchSize;
        const itemsToProcess = currentHasMore ? knowledgeItems.slice(0, batchSize) : knowledgeItems;
        const filteredItems = filterKnowledgeItems(itemsToProcess, input.knowledgeBaseId);

        ids.push(...filteredItems.map((item) => item.id));

        offset += itemsToProcess.length;
        hasMore = currentHasMore;
      }

      return { ids, total: ids.length };
    }),

  deleteKnowledgeItemsByQuery: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(QueryFileListSchema)
    .mutation(async ({ ctx, input }): Promise<{ count: number }> => {
      const fileIds: string[] = [];
      const documentIds: string[] = [];
      const batchSize = 500;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const knowledgeItems = await ctx.knowledgeRepo.query({
          ...input,
          limit: batchSize + 1,
          offset,
        });

        const currentHasMore = knowledgeItems.length > batchSize;
        const itemsToProcess = currentHasMore ? knowledgeItems.slice(0, batchSize) : knowledgeItems;
        const filteredItems = filterKnowledgeItems(itemsToProcess, input.knowledgeBaseId);

        for (const item of filteredItems) {
          if (item.sourceType === DERIVED_DOCUMENT_SOURCE_TYPE) {
            documentIds.push(item.documentId ?? item.id);
            continue;
          }

          if (item.documentId) {
            documentIds.push(item.documentId);
            continue;
          }

          fileIds.push(item.fileId ?? item.id);
        }

        offset += itemsToProcess.length;
        hasMore = currentHasMore;
      }

      if (documentIds.length > 0) {
        await ctx.documentService.deleteDocuments(documentIds);
      }

      if (fileIds.length > 0) {
        const needToRemoveFileList = await ctx.fileModel.deleteMany(
          fileIds,
          serverDBEnv.REMOVE_GLOBAL_FILE,
        );

        if (needToRemoveFileList && needToRemoveFileList.length > 0) {
          await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
        }
      }

      return { count: fileIds.length + documentIds.length };
    }),

  recentFiles: fileProcedure
    .input(z.object({ limit: z.number().max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Query recent items and filter for files only (exclude documents/pages)
      const allItems = await ctx.knowledgeRepo.queryRecent(limit * 3); // Query more to ensure we have enough files after filtering
      const fileItems = allItems
        .filter((item) => item.sourceType === 'file' && item.fileType !== CUSTOM_DOCUMENT_FILE_TYPE)
        .slice(0, limit);

      if (fileItems.length === 0) return [];

      // Get file IDs for batch processing
      const fileIds = fileItems.map((item) => item.id);
      const chunksArray = await ctx.chunkModel.countByFileIds(fileIds);
      const chunks: Record<string, number> = {};
      for (const item of chunksArray) {
        if (item.id) chunks[item.id] = item.count;
      }

      const chunkTaskIds = fileItems.map((item) => item.chunkTaskId).filter(Boolean) as string[];
      const embeddingTaskIds = fileItems
        .map((item) => item.embeddingTaskId)
        .filter(Boolean) as string[];

      const [chunkTasks, embeddingTasks] = await Promise.all([
        chunkTaskIds.length > 0
          ? ctx.asyncTaskModel.findByIds(chunkTaskIds, AsyncTaskType.Chunking)
          : Promise.resolve([]),
        embeddingTaskIds.length > 0
          ? ctx.asyncTaskModel.findByIds(embeddingTaskIds, AsyncTaskType.Embedding)
          : Promise.resolve([]),
      ]);

      // Build result with task status
      const resultFiles: FileListItem[] = [];
      for (const item of fileItems) {
        const chunkTask = item.chunkTaskId
          ? chunkTasks.find((task) => task.id === item.chunkTaskId)
          : null;
        const embeddingTask = item.embeddingTaskId
          ? embeddingTasks.find((task) => task.id === item.embeddingTaskId)
          : null;

        resultFiles.push({
          ...item,
          chunkCount: chunks[item.id] ?? 0,
          chunkingError: chunkTask?.error ?? null,
          chunkingStatus: chunkTask?.status as AsyncTaskStatus,
          embeddingError: embeddingTask?.error ?? null,
          embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
          finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
          sourceType: 'file' as const,
          url: await ctx.fileService.getFileAccessUrl(item),
        } as FileListItem);
      }

      return resultFiles;
    }),

  recentPages: fileProcedure
    .input(z.object({ limit: z.number().max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Query recent items and filter for pages (documents) only, exclude folders
      const allItems = await ctx.knowledgeRepo.queryRecent(limit * 3); // Query more to ensure we have enough pages after filtering
      return allItems
        .filter(
          (item) =>
            item.sourceType === DERIVED_DOCUMENT_SOURCE_TYPE &&
            item.fileType !== CUSTOM_FOLDER_FILE_TYPE,
        )
        .slice(0, limit);
    }),

  removeAllFiles: fileProcedure
    .use(withScopedPermission('file:delete'))
    .mutation(async ({ ctx }) => {
      // Get all file IDs for this user
      const allFiles = await ctx.fileModel.query({ showFilesInKnowledgeBase: true });
      const fileIds = allFiles.map((f) => f.id);

      // Use deleteMany to properly handle shared files (globalFiles reference counting)
      const needToRemoveFileList = await ctx.fileModel.deleteMany(
        fileIds,
        serverDBEnv.REMOVE_GLOBAL_FILE,
      );

      // Delete S3 files only if no other users reference them
      if (needToRemoveFileList && needToRemoveFileList.length > 0) {
        await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
      }
    }),

  removeFile: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const file = await ctx.fileModel.delete(input.id, serverDBEnv.REMOVE_GLOBAL_FILE);

      if (!file) return;

      // delete the file from S3 if it is not used by other files
      await ctx.fileService.deleteFile(file.url!);
    }),

  removeFileAsyncTask: fileProcedure
    .use(withScopedPermission('file:update'))
    .input(
      z.object({
        id: z.string(),
        type: z.enum(['embedding', 'chunk']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.id);

      if (!file) return;

      const taskId = input.type === 'embedding' ? file.embeddingTaskId : file.chunkTaskId;

      if (!taskId) return;

      await ctx.asyncTaskModel.delete(taskId);
    }),

  removeFiles: fileProcedure
    .use(withScopedPermission('file:delete'))
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const needToRemoveFileList = await ctx.fileModel.deleteMany(
        input.ids,
        serverDBEnv.REMOVE_GLOBAL_FILE,
      );

      if (!needToRemoveFileList || needToRemoveFileList.length === 0) return;

      // remove from S3
      await ctx.fileService.deleteFiles(needToRemoveFileList.map((file) => file.url!));
    }),

  updateFile: fileProcedure
    .use(withScopedPermission('file:update'))
    .input(
      z.object({
        id: z.string(),
        metadata: z.record(z.string(), z.any()).optional(),
        name: z.string().optional(),
        parentId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, metadata, name, parentId } = input;

      // Resolve parentId if it's a slug (otherwise use as-is)
      let resolvedParentId: string | null | undefined = parentId;
      if (parentId) {
        const docBySlug = await ctx.documentModel.findBySlug(parentId);
        if (docBySlug) {
          resolvedParentId = docBySlug.id;
        }
      }

      const updates: Parameters<typeof ctx.fileModel.update>[1] = {};

      if (metadata !== undefined) {
        updates.metadata = metadata;
      }

      if (name !== undefined) {
        updates.name = name;
      }

      if (parentId !== undefined) {
        updates.parentId = resolvedParentId;
      }

      if (Object.keys(updates).length > 0) {
        await ctx.fileModel.update(id, updates);
      }

      return { success: true };
    }),

  transferEntity: fileProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        entityType: fileTransferEntityTypeSchema,
        id: z.string(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetWorkspaceId === (ctx.workspaceId ?? null)) {
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.SameWorkspace } },
          code: 'BAD_REQUEST',
          message: 'Cannot transfer to the same workspace',
        });
      }

      if (input.targetWorkspaceId) {
        const [targetMembership] = await ctx.serverDB
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.targetWorkspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!targetMembership || targetMembership.role === 'viewer') {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      if (input.entityType === 'folder' || input.entityType === 'document') {
        const document = await ctx.documentModel.findById(input.id);
        if (!document) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.ResourceNotFound } },
            code: 'NOT_FOUND',
            message: input.entityType === 'folder' ? 'Folder not found' : 'Document not found',
          });
        }
        const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.id);
        await businessFileTransferStorageCheck({
          additionalSize,
          targetUserId: ctx.userId,
          targetWorkspaceId: input.targetWorkspaceId,
        });
        return ctx.documentModel.transferTo(input.id, input.targetWorkspaceId, ctx.userId);
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'File not found',
        });
      await businessFileTransferStorageCheck({
        additionalSize: file.size,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });
      return ctx.fileModel.transferTo(input.id, input.targetWorkspaceId, ctx.userId);
    }),

  copyEntityToWorkspace: fileProcedure
    .use(withScopedPermission('file:upload'))
    .input(
      z.object({
        entityType: fileTransferEntityTypeSchema,
        id: z.string(),
        targetWorkspaceId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetWorkspaceId) {
        const [targetMembership] = await ctx.serverDB
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.targetWorkspaceId),
              eq(workspaceMembers.userId, ctx.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!targetMembership || targetMembership.role === 'viewer') {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.TargetNoWriteAccess } },
            code: 'FORBIDDEN',
            message: 'No write access to target workspace',
          });
        }
      }

      if (input.entityType === 'folder' || input.entityType === 'document') {
        const document = await ctx.documentModel.findById(input.id);
        if (!document) {
          throw new TRPCError({
            cause: { data: { code: TransferErrorCode.ResourceNotFound } },
            code: 'NOT_FOUND',
            message: input.entityType === 'folder' ? 'Folder not found' : 'Document not found',
          });
        }
        const additionalSize = await ctx.documentModel.countFileUsageInSubtree(input.id);
        await businessFileTransferStorageCheck({
          additionalSize,
          targetUserId: ctx.userId,
          targetWorkspaceId: input.targetWorkspaceId,
        });
        return ctx.documentModel.copyToWorkspace(input.id, input.targetWorkspaceId, ctx.userId);
      }

      const file = await ctx.fileModel.findById(input.id);
      if (!file)
        throw new TRPCError({
          cause: { data: { code: TransferErrorCode.ResourceNotFound } },
          code: 'NOT_FOUND',
          message: 'File not found',
        });
      await businessFileTransferStorageCheck({
        additionalSize: file.size,
        targetUserId: ctx.userId,
        targetWorkspaceId: input.targetWorkspaceId,
      });
      return ctx.fileModel.copyToWorkspace(input.id, input.targetWorkspaceId, ctx.userId);
    }),
});

export type FileRouter = typeof fileRouter;
