import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import type { FileListItem } from '@/types/files';
import { QueryFileListSchema } from '@/types/files';

import {
  assertFileNotInRestrictedKnowledgeBase,
  assertKnowledgeBaseBrowsable,
  getRestrictedKnowledgeBaseIds,
} from '../_helpers/knowledgeBaseAccess';
import { fileProcedure, getKnowledgeItemStatusMap } from './procedures';

export const queriesProcedures = {
  findById: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.fileModel.findById(input.id);
      if (!item) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });

      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

      return {
        chunkTaskId: item.chunkTaskId,
        clientId: item.clientId,
        createdAt: item.createdAt,
        embeddingTaskId: item.embeddingTaskId,
        fileHash: item.fileHash,
        fileType: item.fileType,
        id: item.id,
        knowledgeBaseIds: await ctx.fileModel.findKnowledgeBaseIds(item.id),
        metadata: item.metadata,
        name: item.name,
        parentId: item.parentId,
        size: item.size,
        source: item.source,
        updatedAt: item.updatedAt,
        url: await ctx.fileService.getFileAccessUrl(item),
        userId: item.userId,
        visibility: item.visibility,
      };
    }),
  /**
   * Direct storage URL for reading a file's bytes in the browser (canvas
   * export). The `/f/:id` proxy answers with a cross-origin redirect, which
   * drops the request's Origin so bucket CORS can never allow it; fetching the
   * storage URL directly keeps the Origin the bucket already allows for uploads.
   */
  getReadableUrl: fileProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const item = await ctx.fileModel.findById(input.id);
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });

      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

      return { url: await ctx.fileService.getFullFileUrl(item.url) };
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

      await assertFileNotInRestrictedKnowledgeBase(ctx, input.id);

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
        userId: item.userId,
        visibility: item.visibility,
      };
    }),
  getFiles: fileProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    if (input.knowledgeBaseId) await assertKnowledgeBaseBrowsable(ctx, input.knowledgeBaseId);
    const excludeKnowledgeBaseIds =
      !input.knowledgeBaseId && input.showFilesInKnowledgeBase
        ? await getRestrictedKnowledgeBaseIds(ctx)
        : undefined;

    const fileList = await ctx.fileModel.query({ ...input, excludeKnowledgeBaseIds });
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
  recentFiles: fileProcedure
    .input(
      z
        .object({
          limit: z.number().max(50).optional(),
          visibility: z.enum(['private', 'public']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Files only (pages are excluded in SQL, so `limit` can't be eaten by
      // page rows that are then filtered out).
      const fileItems = await ctx.knowledgeRepo.queryRecent(limit, 'file', input?.visibility);

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
    .input(
      z
        .object({
          limit: z.number().max(50).optional(),
          visibility: z.enum(['private', 'public']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 12;
      // Pages only (folders and files are excluded in SQL, so `limit` can't be
      // eaten by rows that are then filtered out).
      return ctx.knowledgeRepo.queryRecent(limit, 'page', input?.visibility);
    }),
};
