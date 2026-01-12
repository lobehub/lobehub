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
import { assertAuthed } from '@/libs/trpc/lambda/context';
import { withAsyncFileModels } from '@/libs/trpc/async/middlewares';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { FileService } from '@/server/services/file';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  type IAsyncTaskError,
} from '@/types/asyncTask';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

const fileProcedure = asyncAuthedProcedure.use(withAsyncFileModels);

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
        let taskFinished = false;

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
          // update the task status to processing
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
                if (taskFinished) return;

                // Read user's provider config from database
                if (!ctx.serverDB) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
                const modelRuntime = await initModelRuntimeFromDB(
                  ctx.serverDB!,
                  ctx.userId!,
                  provider,
                );

                const embeddings = await modelRuntime.embeddings({
                  dimensions: 1024,
                  input: chunks.map((c: NewChunkItem) => c.text),
                  model,
                });

                const items: NewEmbeddingsItem[] =
                  (embeddings?.map((e, idx) => ({
                    chunkId: chunks[idx].id,
                    embeddings: e,
                    fileId: input.fileId,
                    model,
                  })) as NewEmbeddingsItem[]) || [];

                if (taskFinished) return;
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

          if (taskFinished) return { success: false };

          // update the task status to success
          await ctx.asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          return { success: true };
        };

        // Race between the chunking process and the timeout
        try {
          const res = await Promise.race([embeddingPromise(), timeoutPromise]);
          taskFinished = true;
          return res;
        } catch (e) {
          taskFinished = true;
          throw e;
        }
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
      return await parseFileToChunksHandler(ctx, input);
    }),
});

export { parseFileToChunksHandler } from './handlers/parseFileToChunks';
