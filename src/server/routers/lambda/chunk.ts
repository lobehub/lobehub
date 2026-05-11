import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { RequestTrigger, SemanticSearchSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { SearchRepo } from '@/database/repositories/search';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { KnowledgeBaseSearchService } from '@/server/services/knowledgeBase';

const chunkProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      chunkService: new ChunkService(ctx.serverDB, ctx.userId),
      documentModel: new DocumentModel(ctx.serverDB, ctx.userId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      knowledgeBaseSearchService: new KnowledgeBaseSearchService(ctx.serverDB, ctx.userId),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      searchRepo: new SearchRepo(ctx.serverDB, ctx.userId),
    },
  });
});

export const chunkRouter = router({
  createEmbeddingChunksTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asyncTaskId = await ctx.chunkService.asyncEmbeddingFileChunks(input.id);

      return { id: asyncTaskId, success: true };
    }),

  createParseFileTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
        skipExist: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asyncTaskId = await ctx.chunkService.asyncParseFileToChunks(input.id, input.skipExist);

      return { id: asyncTaskId, success: true };
    }),

  getChunksByFileId: chunkProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        id: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return {
        items: await ctx.chunkModel.findByFileId(input.id, input.cursor || 0),
        nextCursor: input.cursor ? input.cursor + 1 : 1,
      };
    }),

  getFileContents: chunkProcedure
    .input(
      z.object({
        // Accepts both file IDs (file_*) and document IDs (docs_*).
        // Name kept as `fileIds` for backward compatibility with existing callers.
        fileIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.knowledgeBaseSearchService.getFileContents(input.fileIds);
    }),

  retryParseFileTask: chunkProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.fileModel.findById(input.id);

      if (!result) return;

      // 1. delete the previous task if exist
      if (result.chunkTaskId) {
        await ctx.asyncTaskModel.delete(result.chunkTaskId);
      }

      // 2. create a new asyncTask for chunking
      const asyncTaskId = await ctx.chunkService.asyncParseFileToChunks(input.id);

      return { id: asyncTaskId, success: true };
    }),

  semanticSearch: chunkProcedure
    .input(
      z.object({
        fileIds: z.array(z.string()).optional(),
        query: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { model, provider } =
        getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;
      // Read user's provider config from database
      const agentRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);

      const embeddings = await agentRuntime.embeddings(
        {
          dimensions: 1024,
          input: input.query,
          model,
        },
        { metadata: { trigger: RequestTrigger.SemanticSearch }, user: ctx.userId },
      );

      return ctx.chunkModel.semanticSearch({
        embedding: embeddings![0],
        fileIds: input.fileIds,
        query: input.query,
      });
    }),

  semanticSearchForChat: chunkProcedure
    .input(SemanticSearchSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.knowledgeBaseSearchService.semanticSearchForChat(input);

      // Backward compatibility: if BM25 was not attempted (no KB scope) AND
      // vector failed, surface the original TRPCError so existing chat flows
      // (which only use vector) get the same diagnostics they did before.
      const knowledgeIds = input.knowledgeIds ?? [];
      const vectorRejection = result.rejections?.vector as any | undefined;
      if (vectorRejection && knowledgeIds.length === 0 && result.documents.length === 0) {
        const errorType = vectorRejection?.errorType;
        if (errorType === 'InvalidProviderAPIKey') {
          throw new TRPCError({
            code: 'METHOD_NOT_SUPPORTED',
            message: vectorRejection.message || 'Invalid API key for embedding provider',
          });
        }
        if (errorType === 'ProviderBizError') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: vectorRejection.message || 'Provider service error',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: vectorRejection?.message || errorType || 'Failed to perform semantic search',
        });
      }

      // TODO: need to rerank the chunks
      return {
        chunks: result.chunks,
        documents: result.documents,
        errors: result.errors,
        fileResults: result.fileResults,
        totalResults: result.totalResults,
      };
    }),
});
