import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { TRPCError } from '@trpc/server';
import { chunk } from 'es-toolkit/compat';
import pMap from 'p-map';
import { z } from 'zod';

import { checkBudgetsUsage, checkEmbeddingUsage } from '@/business/server/trpc-middlewares/async';
import { serverDBEnv } from '@/config/db';
import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@/const/settings/knowledge';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { type NewChunkItem, type NewEmbeddingsItem } from '@/database/schemas';
import { fileEnv } from '@/envs/file';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { FileService } from '@/server/services/file';
import { type IAsyncTaskError } from '@/types/asyncTask';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

const fileProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      chunkService: new ChunkService(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

export const fileRouter = router({
  embeddingChunks: fileProcedure
    .use(checkEmbeddingUsage)
    .use(checkBudgetsUsage)
    .input(
      z.object({
        fileId: z.string(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.fileId);

      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }

      const asyncTask = await ctx.asyncTaskModel.findById(input.taskId);

      const { model, provider } =
        getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;

      if (!asyncTask) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new AsyncTaskError(
                AsyncTaskErrorType.Timeout,
                'embedding task is timeout, please try again',
              ),
            );
          }, ASYNC_TASK_TIMEOUT);
        });

        const embeddingPromise = async () => {
          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            status: AsyncTaskStatus.Processing,
          });

          const startAt = Date.now();

          const CHUNK_SIZE = 50;
          const CONCURRENCY = 10;

          const chunks = await ctx.chunkModel.getChunksTextByFileId(input.fileId);
          const requestArray = chunk(chunks, CHUNK_SIZE);
          try {
            await pMap(
              requestArray,
              async (chunks) => {
                // Read user's provider config from database
                const modelRuntime = await initModelRuntimeFromDB(
                  ctx.serverDB,
                  ctx.userId,
                  provider,
                );

                const embeddings = await modelRuntime.embeddings({
                  dimensions: 1024,
                  input: chunks.map((c) => c.text),
                  model,
                });

                const items: NewEmbeddingsItem[] =
                  embeddings?.map((e, idx) => ({
                    chunkId: chunks[idx].id,
                    embeddings: e,
                    fileId: input.fileId,
                    model,
                  })) || [];

                await ctx.embeddingModel.bulkCreate(items);
              },
              { concurrency: CONCURRENCY },
            );
          } catch (e: any) {
            throw {
              message: e.errorType ?? e.message ?? JSON.stringify(e),
              name: AsyncTaskErrorType.EmbeddingError,
            };
          }

          const duration = Date.now() - startAt;
          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          return { success: true };
        };

        // Race between the chunking process and the timeout
        return await Promise.race([embeddingPromise(), timeoutPromise]);
      } catch (e) {
        console.error('embeddingChunks error', e);

        await ctx.asyncTaskModel.update(input.taskId, {
          error: new AsyncTaskError((e as Error).name, (e as Error).message),
          status: AsyncTaskStatus.Error,
        });

        return {
          message: `File ${file.name}(${input.taskId}) failed to embedding: ${(e as Error).message}`,
          success: false,
        };
      }
    }),

  parseFileToChunks: fileProcedure
    .input(
      z.object({
        fileId: z.string(),
        taskId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.fileModel.findById(input.fileId);
      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }

      let content: Uint8Array | undefined;
      try {
        content = await ctx.fileService.getFileByteArray(file.url);
      } catch (e) {
        console.error(e);
        // if file not found, delete it from db
        if ((e as any).Code === 'NoSuchKey') {
          await ctx.fileModel.delete(input.fileId, serverDBEnv.REMOVE_GLOBAL_FILE);
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
        }
      }

      if (!content) return;

      const asyncTask = await ctx.asyncTaskModel.findById(input.taskId);

      if (!asyncTask) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

      try {
        const startAt = Date.now();

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new AsyncTaskError(
                AsyncTaskErrorType.Timeout,
                'chunking task is timeout, please try again',
              ),
            );
          }, ASYNC_TASK_TIMEOUT);
        });

        const chunkingPromise = async () => {
          const chunkService = ctx.chunkService;
          // update the task status to processing
          await ctx.asyncTaskModel.update(input.taskId, { status: AsyncTaskStatus.Processing });

          // partition file to chunks
          const chunkResult = await chunkService.chunkContent({
            content,
            fileType: file.fileType,
            filename: file.name,
          });

          // after finish partition, we need to filter out some elements
          const chunks = chunkResult.chunks.map(
            ({ text, ...item }): NewChunkItem => ({
              ...item,
              text: text ? sanitizeUTF8(text) : '',
              userId: ctx.userId,
            }),
          );

          const duration = Date.now() - startAt;

          // if no chunk found, throw error
          if (chunks.length === 0) {
            throw {
              message:
                'No chunk found in this file. it may due to current chunking method can not parse file accurately',
              name: AsyncTaskErrorType.NoChunkError,
            };
          }

          await ctx.chunkModel.bulkCreate(chunks, input.fileId);

          if (chunkResult.unstructuredChunks) {
            const unstructuredChunks = chunkResult.unstructuredChunks.map(
              (item): NewChunkItem => ({ ...item, fileId: input.fileId, userId: ctx.userId }),
            );
            await ctx.chunkModel.bulkCreateUnstructuredChunks(unstructuredChunks);
          }

          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          // if enable auto embedding, trigger the embedding task
          if (fileEnv.CHUNKS_AUTO_EMBEDDING) {
            await chunkService.asyncEmbeddingFileChunks(input.fileId);
          }

          return { success: true };
        };
        // Race between the chunking process and the timeout
        return await Promise.race([chunkingPromise(), timeoutPromise]);
      } catch (e) {
        const error = e as any;

        const asyncTaskError = error.body
          ? ({ body: safeParseJSON(error.body) ?? error.body, name: error.name } as IAsyncTaskError)
          : new AsyncTaskError((error as Error).name, error.message);

        console.error('[Chunking Error]', asyncTaskError);
        await ctx.asyncTaskModel.update(input.taskId, {
          error: asyncTaskError,
          status: AsyncTaskStatus.Error,
        });

        return {
          message: `File ${file.name}(${input.taskId}) failed to chunking: ${(e as Error).message}`,
          success: false,
        };
      }
    }),
});
