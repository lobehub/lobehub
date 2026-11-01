import { TRPCError } from '@trpc/server';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { FileUploadService } from '@/server/services/fileUpload';
import { AsyncTaskStatus, AsyncTaskType, type IAsyncTaskError } from '@/types/asyncTask';
import type { KnowledgeItemStatus } from '@/types/files';

import type { KnowledgeBaseAccessCtx } from '../_helpers/knowledgeBaseAccess';
import { assertContentsNotInRestrictedKnowledgeBase } from '../_helpers/knowledgeBaseAccess';

export const fileProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
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
      fileUploadService: new FileUploadService(ctx.serverDB, ctx.userId, wsId),
      knowledgeBaseModel: new KnowledgeBaseModel(ctx.serverDB, ctx.userId, wsId),
      knowledgeRepo: new KnowledgeRepo(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const getKnowledgeItemStatusMap = async (
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

export const resolveAccessibleParentDocument = async (
  ctx: KnowledgeBaseAccessCtx & {
    documentModel: Pick<DocumentModel, 'findById' | 'findBySlug'>;
  },
  parentId: string,
) => {
  const parentDocument =
    (await ctx.documentModel.findBySlug(parentId)) ?? (await ctx.documentModel.findById(parentId));

  if (!parentDocument) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent document not found' });
  }

  await assertContentsNotInRestrictedKnowledgeBase(ctx, [parentDocument.id]);
  return parentDocument;
};
