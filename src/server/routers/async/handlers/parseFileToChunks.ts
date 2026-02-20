// Keep this module import-light; no env reads at module scope; intended for unit tests.
// Avoid importing server-only modules here so tests can import this handler without pulling heavy envs.
import { TRPCError } from '@trpc/server';
import { serverDBEnv } from '@/config/db';
import { fileEnv } from '@/envs/file';
import {
    AsyncTaskError,
    AsyncTaskErrorType,
    AsyncTaskStatus,
    type IAsyncTaskError,
} from '@/types/asyncTask';
import { safeParseJSON } from '@/utils/safeParseJSON';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';
import { type NewChunkItem } from '@/database/schemas';

export const parseFileToChunksHandler = async (ctx: any, input: { fileId: string; taskId: string }) => {
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
            }, (global as any).ASYNC_TASK_TIMEOUT ?? 30000);
        });

        let taskFinished = false;

        const chunkingPromise = async () => {
            try {
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

                if (taskFinished) return { success: false };
                await ctx.chunkModel.bulkCreate(chunks, input.fileId);

                if (chunkResult.unstructuredChunks) {
                    const unstructuredChunks = chunkResult.unstructuredChunks.map(
                        (item): NewChunkItem => ({ ...item, fileId: input.fileId, userId: ctx.userId }),
                    );
                    if (!taskFinished) await ctx.chunkModel.bulkCreateUnstructuredChunks(unstructuredChunks);
                }

                // update the task status to success
                if (taskFinished) return { success: false };
                await ctx.asyncTaskModel.update(input.taskId, {
                    duration,
                    status: AsyncTaskStatus.Success,
                });

                // if enable auto embedding, trigger the embedding task
                if (!taskFinished && fileEnv.CHUNKS_AUTO_EMBEDDING) {
                    await ctx.chunkService?.asyncEmbeddingFileChunks(input.fileId);
                }

                // Return success after chunking (embedding may run in background)
                return { success: true };
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
        };

        // Race between the chunking process and the timeout
        try {
            const res = await Promise.race([chunkingPromise(), timeoutPromise]);
            taskFinished = true;
            return res;
        } catch (e) {
            taskFinished = true;
            throw e;
        }
    } catch (e) {
        console.error('parseFileToChunks error', e);

        await ctx.asyncTaskModel.update(input.taskId, {
            error: new AsyncTaskError((e as Error).name, (e as Error).message),
            status: AsyncTaskStatus.Error,
        });

        return {
            message: `File ${file.name}(${input.taskId}) failed to chunking: ${(e as Error).message}`,
            success: false,
        };
    }
};
