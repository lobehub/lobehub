import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { chunk } from 'es-toolkit/compat';
import pMap from 'p-map';
import { z } from 'zod';

import { checkEmbeddingUsage } from '@/business/server/trpc-middlewares/async';
import { FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE, MAX_FILE_PARSE_SIZE } from '@/const/file';
import { DEFAULT_FILE_EMBEDDING_MODEL_ITEM } from '@/const/settings/knowledge';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { EmbeddingModel } from '@/database/models/embedding';
import { FileModel } from '@/database/models/file';
import { type NewChunkItem, type NewEmbeddingsItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { fileEnv } from '@/envs/file';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { ChunkService } from '@/server/services/chunk';
import { DocumentService } from '@/server/services/document';
import { FileService } from '@/server/services/file';
import { type IAsyncTaskError } from '@/types/asyncTask';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

/**
 * How long a failed embedding task waits for its in-flight batches before it is marked
 * failed. Keep it below the margin any quota reservation tied to the `processing` state allows.
 */
const IN_FLIGHT_BATCH_GRACE_MS = 30_000;

const fileProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      chunkModel: new ChunkModel(ctx.serverDB, ctx.userId),
      chunkService: new ChunkService(ctx.serverDB, ctx.userId),
      documentService: new DocumentService(ctx.serverDB, ctx.userId),
      embeddingModel: new EmbeddingModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      fileService: new FileService(ctx.serverDB, ctx.userId),
    },
  });
});

/**
 * Parsing and splitting a file is synchronous CPU work on this process' event loop, and every
 * running task keeps a whole file (up to MAX_FILE_PARSE_SIZE) in memory. A folder upload fires
 * one task per file at once, so they queue here instead of all running together and starving
 * every other request served by this process.
 */
const PARSE_CONCURRENCY = 2;
let activeParses = 0;
const waitingParses: (() => void)[] = [];

interface ParseSlot {
  /** Keeps the slot until `work` settles, even when the caller stops waiting for it. */
  holdUntil: (work: Promise<unknown>) => void;
  release: () => void;
}

const withParseSlot = async <T>(fn: (slot: ParseSlot) => Promise<T>): Promise<T> => {
  if (activeParses < PARSE_CONCURRENCY) activeParses++;
  // a finishing task hands its slot straight to the next waiter
  else await new Promise<void>((resolve) => waitingParses.push(resolve));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const next = waitingParses.shift();
    if (next) next();
    else activeParses--;
  };

  let held: Promise<unknown> | undefined;
  try {
    return await fn({
      holdUntil: (work) => {
        held = work;
      },
      release,
    });
  } finally {
    if (held) void held.then(release, release);
    else release();
  }
};

const resolveWorkspaceIdFromFile = async (
  serverDB: LobeChatDatabase,
  userId: string,
  fileId: string,
  workspaceId?: string,
) => {
  if (workspaceId) return workspaceId;

  if (typeof FileModel.getFileById !== 'function') return undefined;

  const file = await FileModel.getFileById(serverDB, fileId);
  if (!file || file.userId !== userId) return undefined;

  return file.workspaceId ?? undefined;
};

export const fileRouter = router({
  embeddingChunks: fileProcedure
    .use(checkEmbeddingUsage)
    .input(
      z.object({
        fileId: z.string(),
        taskId: z.string(),
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = await resolveWorkspaceIdFromFile(
        ctx.serverDB,
        ctx.userId,
        input.fileId,
        input.workspaceId,
      );
      const asyncTaskModel = new AsyncTaskModel(ctx.serverDB, ctx.userId, workspaceId);
      const chunkModel = new ChunkModel(ctx.serverDB, ctx.userId, workspaceId);
      const embeddingModel = new EmbeddingModel(ctx.serverDB, ctx.userId, workspaceId);
      const fileModel = new FileModel(ctx.serverDB, ctx.userId, workspaceId);
      const file = await fileModel.findById(input.fileId);

      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }

      const asyncTask = await asyncTaskModel.findById(input.taskId);

      const { model, provider } =
        getServerDefaultFilesConfig().embeddingModel || DEFAULT_FILE_EMBEDDING_MODEL_ITEM;

      if (!asyncTask) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

      // `Promise.race` and `pMap` only stop waiting: without these, batches already running
      // keep calling the provider and writing vectors after the task is reported failed, which
      // is also when the vector quota stops reserving room for this task.
      let stopped = false;
      const inFlightBatches = new Set<Promise<void>>();
      const assertWritable = () => {
        if (stopped) throw new Error('embedding task already stopped');
      };

      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            stopped = true;
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
          await asyncTaskModel.update(input.taskId, {
            status: AsyncTaskStatus.Processing,
          });

          const startAt = Date.now();

          const CHUNK_SIZE = fileEnv.EMBEDDING_BATCH_SIZE;
          const CONCURRENCY = fileEnv.EMBEDDING_CONCURRENCY;

          const chunks = await chunkModel.getChunksTextByFileId(input.fileId);
          const requestArray = chunk(chunks, CHUNK_SIZE);
          try {
            await pMap(
              requestArray,
              async (chunks) => {
                const batch = (async () => {
                  assertWritable();
                  // Read user's provider config from database
                  const modelRuntime = await initModelRuntimeFromDB(
                    ctx.serverDB,
                    ctx.userId,
                    provider,
                    workspaceId,
                  );

                  const embeddings = await modelRuntime.embeddings(
                    {
                      dimensions: 1024,
                      input: chunks.map((c) => c.text),
                      model,
                    },
                    { metadata: { trigger: RequestTrigger.FileEmbedding }, user: ctx.userId },
                  );

                  const items: NewEmbeddingsItem[] =
                    embeddings?.map((e, idx) => ({
                      chunkId: chunks[idx].id,
                      embeddings: e,
                      fileId: input.fileId,
                      model,
                    })) || [];

                  assertWritable();
                  await embeddingModel.bulkCreate(items);
                })();

                inFlightBatches.add(batch);
                try {
                  await batch;
                } catch (e) {
                  // One failed batch fails the task: stop its siblings from writing more.
                  stopped = true;
                  throw e;
                } finally {
                  inFlightBatches.delete(batch);
                }
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
          await asyncTaskModel.update(input.taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          return { success: true };
        };

        // Race between the chunking process and the timeout
        return await Promise.race([embeddingPromise(), timeoutPromise]);
      } catch (e) {
        console.error('embeddingChunks error', e);

        // Keep the task processing, which holds its vector reservation, until the batches
        // already writing settle. Bounded so a hung provider call cannot pin the task; once
        // `stopped` is set such a batch can no longer write anyway.
        stopped = true;
        await Promise.race([
          Promise.allSettled(inFlightBatches),
          new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_BATCH_GRACE_MS)),
        ]);

        await asyncTaskModel.update(input.taskId, {
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
        workspaceId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const workspaceId = await resolveWorkspaceIdFromFile(
        ctx.serverDB,
        ctx.userId,
        input.fileId,
        input.workspaceId,
      );
      const asyncTaskModel = new AsyncTaskModel(ctx.serverDB, ctx.userId, workspaceId);
      const chunkModel = new ChunkModel(ctx.serverDB, ctx.userId, workspaceId);
      const chunkService = new ChunkService(ctx.serverDB, ctx.userId, workspaceId);
      const documentService = new DocumentService(ctx.serverDB, ctx.userId, workspaceId);
      const fileModel = new FileModel(ctx.serverDB, ctx.userId, workspaceId);
      const fileService = new FileService(ctx.serverDB, ctx.userId, workspaceId);
      const file = await fileModel.findById(input.fileId);
      if (!file) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File not found' });
      }

      if (file.size > MAX_FILE_PARSE_SIZE) {
        await asyncTaskModel.update(input.taskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.FileTooLargeToParse,
            FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE,
          ),
          status: AsyncTaskStatus.Error,
        });

        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE,
        });
      }

      // Inline documents (custom/document) keep a mirror file row whose url is the
      // `internal://document/placeholder` marker. Their content lives on documents.content
      // and is intentionally not chunked — searching is handled by BM25 instead.
      if (file.url.startsWith('internal://')) {
        await asyncTaskModel.update(input.taskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.TaskTriggerError,
            'Inline documents (custom/document) do not require chunking; content is searched via BM25.',
          ),
          status: AsyncTaskStatus.Error,
        });
        return {
          message: `File ${file.name}(${input.taskId}) is an inline document and was skipped`,
          success: false,
        };
      }

      const parse = async (slot: ParseSlot) => {
        let content: Uint8Array | undefined;
        try {
          content = await fileService.getFileByteArray(file.url);
        } catch (e) {
          console.error(e);
          const errorCode = (e as any).Code;
          // Storage returned NoSuchKey. Do NOT delete the file row — transient S3
          // outages, IAM misconfig, or already-orphaned DB rows must not cascade
          // into destroying chunks/embeddings/documents. Mark the task as Error
          // so users see a clear message and can re-upload or retry.
          if (errorCode === 'NoSuchKey') {
            await asyncTaskModel.update(input.taskId, {
              error: new AsyncTaskError(
                AsyncTaskErrorType.TaskTriggerError,
                'File content unavailable in storage. Verify storage access or re-upload.',
              ),
              status: AsyncTaskStatus.Error,
            });
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'File content unavailable in storage.',
            });
          }
          // Other fetch errors (network, IAM, etc.) — mark the task as Error so
          // the user surface stays consistent, then propagate.
          await asyncTaskModel.update(input.taskId, {
            error: new AsyncTaskError(
              AsyncTaskErrorType.TaskTriggerError,
              `Failed to fetch file content: ${(e as Error)?.message ?? errorCode ?? 'unknown error'}`,
            ),
            status: AsyncTaskStatus.Error,
          });
          throw e;
        }

        if (!content) return;

        const asyncTask = await asyncTaskModel.findById(input.taskId);

        if (!asyncTask)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Async Task not found' });

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
            // The task was created before it queued for a slot, and the stale-task watchdog
            // expires tasks by `createdAt`. Restart that clock now that parsing really begins,
            // and clear an expiry the watchdog may have written while the file was waiting.
            await asyncTaskModel.update(input.taskId, {
              createdAt: new Date(),
              error: null,
              status: AsyncTaskStatus.Processing,
            });

            // parse file to document record first (for detailed content viewing)
            try {
              await documentService.parseFile(input.fileId);
            } catch (e) {
              // document parsing failure should not block chunking
              console.warn(
                '[parseFileToChunks] document parsing failed, continuing with chunking:',
                e,
              );
            }

            // partition file to chunks
            const chunkResult = await chunkService.chunkContent({
              content,
              fileType: file.fileType,
              filename: file.name,
            });

            // after finish partition, we need to filter out some elements
            const chunks = chunkResult.chunks.map(({ text, ...item }): NewChunkItem => ({
              ...item,
              text: text ? sanitizeUTF8(text) : '',
              userId: ctx.userId,
              workspaceId,
            }));

            const duration = Date.now() - startAt;

            // if no chunk found, throw error
            if (chunks.length === 0) {
              throw {
                message:
                  'No chunk found in this file. it may due to current chunking method can not parse file accurately',
                name: AsyncTaskErrorType.NoChunkError,
              };
            }

            await chunkModel.bulkCreate(chunks, input.fileId);

            if (chunkResult.unstructuredChunks) {
              const unstructuredChunks = chunkResult.unstructuredChunks.map(
                (item): NewChunkItem => ({
                  ...item,
                  fileId: input.fileId,
                  userId: ctx.userId,
                  workspaceId,
                }),
              );
              await chunkModel.bulkCreateUnstructuredChunks(unstructuredChunks);
            }

            // update the task status to success
            await asyncTaskModel.update(input.taskId, {
              duration,
              status: AsyncTaskStatus.Success,
            });

            // if enable auto embedding, trigger the embedding task
            if (fileEnv.CHUNKS_AUTO_EMBEDDING) {
              // It is network-bound and can run long: free the parse slot first, so it never
              // holds back the files still waiting to be parsed.
              slot.release();
              await chunkService.asyncEmbeddingFileChunks(input.fileId);
            }

            return { success: true };
          };
          // Race between the chunking process and the timeout
          // A timeout only stops the wait: the work keeps running and keeps the file in memory,
          // so the slot stays taken until it is really done.
          const chunking = chunkingPromise();
          slot.holdUntil(chunking);
          return await Promise.race([chunking, timeoutPromise]);
        } catch (e) {
          const error = e as any;

          const asyncTaskError = error.body
            ? ({
                body: safeParseJSON(error.body) ?? error.body,
                name: error.name,
              } as IAsyncTaskError)
            : new AsyncTaskError((error as Error).name, error.message);

          console.error('[Chunking Error]', asyncTaskError);
          await asyncTaskModel.update(input.taskId, {
            error: asyncTaskError,
            status: AsyncTaskStatus.Error,
          });

          return {
            message: `File ${file.name}(${input.taskId}) failed to chunking: ${(e as Error).message}`,
            success: false,
          };
        }
      };

      // Status polling expires tasks by createdAt, even before they get a parse slot.
      // Keep waiting tasks fresh so the UI never sees a transient timeout and stops polling.
      const refreshWaitingTask = () =>
        asyncTaskModel.update(input.taskId, { createdAt: new Date() });
      await refreshWaitingTask();
      let refreshing: Promise<unknown> = Promise.resolve();
      const heartbeat = setInterval(() => {
        refreshing = refreshing.then(refreshWaitingTask).catch((error) => {
          console.error('[parseFileToChunks] failed to refresh queued task:', error);
        });
      }, ASYNC_TASK_TIMEOUT / 2);

      try {
        return await withParseSlot(async (slot) => {
          clearInterval(heartbeat);
          // Drain an in-flight refresh before parsing changes this task's status or clock.
          await refreshing;
          return parse(slot);
        });
      } finally {
        clearInterval(heartbeat);
      }
    }),
});
