import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { businessFileUploadCheck } from '@/business/server/lambda-routers/file';
import { checkFileStorageUsage } from '@/business/server/trpc-middlewares/lambda';
import { serverDBEnv } from '@/config/db';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';
import { QueryFileListSchema, UploadFileSchema } from '@/types/files';

/**
 * Generate file proxy URL
 * Returns a unified proxy URL format: ${APP_URL}/f/:id
 */
const getFileProxyUrl = (fileId: string): string => `${appEnv.APP_URL}/f/${fileId}`;

const fileProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
      knowledgeRepo: new KnowledgeRepo(ctx.serverDB, ctx.userId),
    },
  });
});

export const fileRouter = router({
  checkFileHash: fileProcedure
    .use(checkFileStorageUsage)
    .input(z.object({ hash: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.fileModel.checkHash(input.hash);
    }),

  createFile: fileProcedure
    .use(checkFileStorageUsage)
    .input(
      UploadFileSchema.omit({ url: true }).extend({
        parentId: z.string().optional(),
        url: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { isExist } = await ctx.fileModel.checkHash(input.hash!);

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

      await businessFileUploadCheck({
        actualSize,
        clientIp: ctx.clientIp ?? undefined,
        inputSize: input.size,
        url: input.url,
        userId: ctx.userId,
      });

      if (actualSize < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File size cannot be negative' });
      }

      const { id } = await ctx.fileModel.create(
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
      );

      return { id, url: getFileProxyUrl(id) };
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
        url: getFileProxyUrl(item.id),
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

      let embeddingTask = null;
      if (item.embeddingTaskId) {
        embeddingTask = await ctx.asyncTaskModel.findById(item.embeddingTaskId);
      }
      let chunkingTask = null;
      if (item.chunkTaskId) {
        chunkingTask = await ctx.asyncTaskModel.findById(item.chunkTaskId);
      }

      const chunkCount = await ctx.chunkModel.countByFileId(input.id);

      return {
        chunkCount,
        chunkingError: chunkingTask?.error,
        chunkingStatus: chunkingTask?.status as AsyncTaskStatus,
        createdAt: item.createdAt,
        embeddingError: embeddingTask?.error,
        embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
        fileType: item.fileType,
        finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
        id: item.id,
        metadata: item.metadata as Record<string, any> | null | undefined,
        name: item.name,
        size: item.size,
        sourceType: 'file' as const,
        updatedAt: item.updatedAt,
        url: getFileProxyUrl(item.id),
      };
    }),

  getFiles: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    const fileList = await ctx.fileModel.query(input);

    const fileIds = fileList.map((item) => item.id);
    const chunks = await ctx.chunkModel.countByFileIds(fileIds);

    const chunkTaskIds = fileList.map((result) => result.chunkTaskId).filter(Boolean) as string[];

    const chunkTasks = await ctx.asyncTaskModel.findByIds(chunkTaskIds, AsyncTaskType.Chunking);

    const embeddingTaskIds = fileList
      .map((result) => result.embeddingTaskId)
      .filter(Boolean) as string[];
    const embeddingTasks = await ctx.asyncTaskModel.findByIds(
      embeddingTaskIds,
      AsyncTaskType.Embedding,
    );

    const resultFiles = [] as any[];
    for (const { chunkTaskId, embeddingTaskId, ...item } of fileList as any[]) {
      const chunkTask = chunkTaskId ? chunkTasks.find((task) => task.id === chunkTaskId) : null;
      const embeddingTask = embeddingTaskId
        ? embeddingTasks.find((task) => task.id === embeddingTaskId)
        : null;

      const fileItem = {
        ...item,
        chunkCount: chunks.find((chunk) => chunk.id === item.id)?.count ?? null,
        chunkingError: chunkTask?.error ?? null,
        chunkingStatus: chunkTask?.status as AsyncTaskStatus,
        embeddingError: embeddingTask?.error ?? null,
        embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
        finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
        sourceType: 'file' as const,
        url: getFileProxyUrl(item.id),
      } as FileListItem;
      resultFiles.push(fileItem);
    }

    return resultFiles;
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
    const filteredItems = !input.knowledgeBaseId
      ? itemsToProcess.filter(
          (item) => !(item.sourceType === 'document' && item.fileType === 'custom/folder'),
        )
      : itemsToProcess;

    // Process files (add chunk info and async task status)
    const fileItems = filteredItems.filter((item) => item.sourceType === 'file');
    const fileIds = fileItems.map((item) => item.id);
    const chunks = await ctx.chunkModel.countByFileIds(fileIds);

    const chunkTaskIds = fileItems.map((item) => item.chunkTaskId).filter(Boolean) as string[];
    const chunkTasks = await ctx.asyncTaskModel.findByIds(chunkTaskIds, AsyncTaskType.Chunking);

    const embeddingTaskIds = fileItems
      .map((item) => item.embeddingTaskId)
      .filter(Boolean) as string[];
    const embeddingTasks = await ctx.asyncTaskModel.findByIds(
      embeddingTaskIds,
      AsyncTaskType.Embedding,
    );

    // Combine all items with their metadata
    const resultItems = [] as any[];
    for (const item of filteredItems) {
      if (item.sourceType === 'file') {
        const chunkTask = item.chunkTaskId
          ? chunkTasks.find((task) => task.id === item.chunkTaskId)
          : null;
        const embeddingTask = item.embeddingTaskId
          ? embeddingTasks.find((task) => task.id === item.embeddingTaskId)
          : null;

        resultItems.push({
          ...item,
          chunkCount: chunks.find((chunk) => chunk.id === item.id)?.count ?? null,
          chunkingError: chunkTask?.error ?? null,
          chunkingStatus: chunkTask?.status as AsyncTaskStatus,
          editorData: null,
          embeddingError: embeddingTask?.error ?? null,
          embeddingStatus: embeddingTask?.status as AsyncTaskStatus,
          finishEmbedding: embeddingTask?.status === AsyncTaskStatus.Success,
          url: getFileProxyUrl(item.id),
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

  recentFiles: fileProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Query recent items and filter for files only (exclude documents/pages)
      const allItems = await ctx.knowledgeRepo.queryRecent(limit * 3); // Query more to ensure we have enough files after filtering
      const fileItems = allItems
        .filter((item) => item.sourceType === 'file' && item.fileType !== 'custom/document')
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
          url: getFileProxyUrl(item.id),
        } as FileListItem);
      }

      return resultFiles;
    }),

  recentPages: fileProcedure
    .input(z.object({ limit: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Query recent items and filter for pages (documents) only, exclude folders
      const allItems = await ctx.knowledgeRepo.queryRecent(limit * 3); // Query more to ensure we have enough pages after filtering
      return allItems
        .filter((item) => item.sourceType === 'document' && item.fileType !== 'custom/folder')
        .slice(0, limit);
    }),

  removeAllFiles: fileProcedure.mutation(async ({ ctx }) => {
    return ctx.fileModel.clear();
  }),

  removeFile: fileProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const file = await ctx.fileModel.delete(input.id, serverDBEnv.REMOVE_GLOBAL_FILE);

    if (!file) return;

    // delete the file from S3 if it is not used by other files
    await ctx.fileService.deleteFile(file.url!);
  }),

  removeFileAsyncTask: fileProcedure
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
    .input(
      z.object({
        id: z.string(),
        parentId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, parentId } = input;

      // Resolve parentId if it's a slug (otherwise use as-is)
      let resolvedParentId: string | null | undefined = parentId;
      if (parentId) {
        const docBySlug = await ctx.documentModel.findBySlug(parentId);
        if (docBySlug) {
          resolvedParentId = docBySlug.id;
        }
      }

      await ctx.fileModel.update(id, { parentId: resolvedParentId });

      return { success: true };
    }),
});

export type FileRouter = typeof fileRouter;
