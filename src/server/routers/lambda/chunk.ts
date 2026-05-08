import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import { type ChatSemanticSearchChunk, type FileSearchResult } from '@lobechat/types';
import { RequestTrigger, SemanticSearchSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { DocumentModel } from '@/database/models/document';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { type KnowledgeBaseDocumentHit, SearchRepo } from '@/database/repositories/search';
import { knowledgeBaseFiles } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';

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
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      searchRepo: new SearchRepo(ctx.serverDB, ctx.userId),
    },
  });
});

/**
 * Group chunks by file and calculate relevance scores
 */
const groupAndRankFiles = (chunks: ChatSemanticSearchChunk[], topK: number): FileSearchResult[] => {
  const fileMap = new Map<string, FileSearchResult>();

  // Group chunks by file
  for (const chunk of chunks) {
    const fileId = chunk.fileId || 'unknown';
    const fileName = chunk.fileName || `File ${fileId}`;

    if (!fileMap.has(fileId)) {
      fileMap.set(fileId, {
        fileId,
        fileName,
        relevanceScore: 0,
        topChunks: [],
      });
    }

    const fileResult = fileMap.get(fileId)!;
    fileResult.topChunks.push({
      id: chunk.id,
      similarity: chunk.similarity,
      text: chunk.text || '',
    });
  }

  // Calculate relevance score for each file (average of top 3 chunks)
  for (const fileResult of fileMap.values()) {
    fileResult.topChunks.sort((a, b) => b.similarity - a.similarity);
    const top3 = fileResult.topChunks.slice(0, 3);
    fileResult.relevanceScore =
      top3.reduce((sum, chunk) => sum + chunk.similarity, 0) / top3.length;
    // Keep only top chunks per file
    fileResult.topChunks = fileResult.topChunks.slice(0, 3);
  }

  // Sort files by relevance score and return top K
  return Array.from(fileMap.values())
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
};

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
      return await pMap(
        input.fileIds,
        async (id) => {
          // ---- Branch A: docs_* — read documents.content directly ----
          // Used by KB inline documents (custom/document) which have no S3 file.
          if (id.startsWith('docs_')) {
            const doc = await ctx.documentModel.findById(id);
            if (!doc) {
              return {
                content: '',
                error: 'Document not found',
                fileId: id,
                filename: `Unknown document ${id}`,
              };
            }
            const content = doc.content ?? '';
            const lines = content.split('\n');
            return {
              content,
              fileId: id,
              filename: doc.title || doc.filename || 'Untitled',
              metadata: doc.metadata,
              preview: lines.slice(0, 5).join('\n'),
              totalCharCount: content.length,
              totalLineCount: lines.length,
            };
          }

          // ---- Branch B: file_* — original file/parse path ----
          // 1. Find file information
          const file = await ctx.fileModel.findById(id);
          if (!file) {
            return {
              content: '',
              error: 'File not found',
              fileId: id,
              filename: `Unknown file ${id}`,
            };
          }

          // 2. Find existing parsed document
          let document:
            | {
                content: string | null;
                metadata: Record<string, any> | null;
              }
            | undefined = await ctx.documentModel.findByFileId(id);

          // 3. If not exists, parse the file
          if (!document) {
            try {
              document = await ctx.documentService.parseFile(id);
            } catch (error) {
              return {
                content: '',
                error: `Failed to parse file: ${(error as Error).message}`,
                fileId: id,
                filename: file.name,
              };
            }
          }

          // 4. Calculate file statistics
          const content = document.content || '';
          const lines = content.split('\n');
          const totalLineCount = lines.length;
          const totalCharCount = content.length;
          const preview = lines.slice(0, 5).join('\n');

          // 5. Return content with details
          return {
            content,
            fileId: id,
            filename: file.name,
            metadata: document.metadata,
            preview,
            totalCharCount,
            totalLineCount,
          };
        },
        { concurrency: 3 },
      );
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
      const topK = input.topK ?? 20;
      const knowledgeIds = input.knowledgeIds ?? [];

      // Path 1: vector search over file chunks
      const vectorPath = async (): Promise<ChatSemanticSearchChunk[]> => {
        const { model, provider } =
          getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;
        const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);

        // slice content to make sure in the context window limit
        const query = input.query.length > 8000 ? input.query.slice(0, 8000) : input.query;

        const embeddings = await modelRuntime.embeddings(
          {
            dimensions: 1024,
            input: query,
            model,
          },
          { metadata: { trigger: RequestTrigger.SemanticSearch }, user: ctx.userId },
        );

        const embedding = embeddings![0];

        let finalFileIds = input.fileIds ?? [];
        if (knowledgeIds.length > 0) {
          const knowledgeFiles = await ctx.serverDB.query.knowledgeBaseFiles.findMany({
            where: inArray(knowledgeBaseFiles.knowledgeBaseId, knowledgeIds),
          });
          finalFileIds = knowledgeFiles.map((f) => f.fileId).concat(finalFileIds);
        }

        return ctx.chunkModel.semanticSearchForChat({
          embedding,
          fileIds: finalFileIds,
          query: input.query,
          topK,
        });
      };

      // Path 2: BM25 search over KB-scoped custom/document documents
      const bm25Path = async (): Promise<KnowledgeBaseDocumentHit[]> => {
        if (knowledgeIds.length === 0) return [];
        return ctx.searchRepo.searchKnowledgeBaseDocuments(input.query, knowledgeIds, topK);
      };

      const [vectorResult, bm25Result] = await Promise.allSettled([vectorPath(), bm25Path()]);

      const chunks: ChatSemanticSearchChunk[] =
        vectorResult.status === 'fulfilled' ? vectorResult.value : [];
      const documents: KnowledgeBaseDocumentHit[] =
        bm25Result.status === 'fulfilled' ? bm25Result.value : [];

      const errors: { bm25?: string; vector?: string } = {};
      if (vectorResult.status === 'rejected') {
        const error = vectorResult.reason as any;
        const errorType = error?.errorType;
        const msg = error?.message || errorType || 'Vector search failed';
        errors.vector = msg;
        console.error('[semanticSearchForChat] vector path failed', error);
      }
      if (bm25Result.status === 'rejected') {
        const error = bm25Result.reason as any;
        errors.bm25 = error?.message || 'BM25 search failed';
        console.error('[semanticSearchForChat] BM25 path failed', error);
      }

      // Backward compatibility: if BM25 was not attempted (no KB scope) AND
      // vector failed, surface the original TRPCError so existing chat flows
      // (which only use vector) get the same diagnostics they did before.
      if (
        vectorResult.status === 'rejected' &&
        knowledgeIds.length === 0 &&
        documents.length === 0
      ) {
        const error = vectorResult.reason as any;
        const errorType = error?.errorType;
        if (errorType === 'InvalidProviderAPIKey') {
          throw new TRPCError({
            code: 'METHOD_NOT_SUPPORTED',
            message: error.message || 'Invalid API key for embedding provider',
          });
        }
        if (errorType === 'ProviderBizError') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.message || 'Provider service error',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message || errorType || 'Failed to perform semantic search',
        });
      }

      const fileResults = groupAndRankFiles(chunks, input.topK || 15);

      // TODO: need to rerank the chunks
      return {
        chunks,
        documents,
        errors: Object.keys(errors).length > 0 ? errors : undefined,
        fileResults,
        totalResults: chunks.length + documents.length,
      };
    }),
});
