import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { FileModel } from '@/database/models/file';
import { KnowledgeRepo } from '@/database/repositories/knowledge';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';
import { QueryFileListSchema } from '@/types/files';

const knowledgeProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
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

export const knowledgeRouter = router({
  getKnowledgeItems: knowledgeProcedure.input(QueryFileListSchema).query(async ({ ctx, input }) => {
    const knowledgeItems = await ctx.knowledgeRepo.query(input);

    // Process files (add chunk info and async task status)
    const fileItems = knowledgeItems.filter((item) => item.sourceType === 'file');
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
    for (const item of knowledgeItems) {
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
          url: await ctx.fileService.getFullFileUrl(item.url!),
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
        console.log('[API getKnowledgeItems] Processing document:', {
          editorDataPreview: item.editorData ? JSON.stringify(item.editorData).slice(0, 100) : null,
          hasEditorData: !!item.editorData,
          id: item.id,
          name: item.name,
        });
        resultItems.push(documentItem);
      }
    }

    return resultItems;
  }),
});

export type KnowledgeRouter = typeof knowledgeRouter;
