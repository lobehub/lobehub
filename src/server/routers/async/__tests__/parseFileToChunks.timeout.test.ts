import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { fileEnv } from '@/envs/file';

// Avoid loading server modules that read server-only envs during import time
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

let parseFileToChunksHandler: any;
beforeEach(async () => {
    // dynamic import after mocks are in place to avoid server env access during module init
    parseFileToChunksHandler = (await import('@/server/routers/async/handlers/parseFileToChunks')).parseFileToChunksHandler;
});

describe('parseFileToChunks timeout guard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        // Make sure auto-embedding won't be triggered in this test
        (fileEnv as any).CHUNKS_AUTO_EMBEDDING = false;
    });

    it('does not overwrite timeout failure with late success', async () => {
        const fileId = 'file-1';
        const taskId = 'task-1';

        // Mocks
        const file = { id: fileId, name: 'myfile', fileType: 'text', url: 's3://bucket/key' };

        const asyncTaskModel = {
            findById: vi.fn().mockResolvedValue({ id: taskId }),
            update: vi.fn().mockResolvedValue(null),
        };

        const fileModel = {
            findById: vi.fn().mockResolvedValue(file),
            delete: vi.fn().mockResolvedValue(null),
        };

        const fileService = {
            getFileByteArray: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        };

        let resolveChunking: (v: any) => void = () => { };
        const chunkingPromise = new Promise((r) => (resolveChunking = r));

        const chunkService = {
            chunkContent: vi.fn().mockReturnValueOnce(chunkingPromise),
            asyncEmbeddingFileChunks: vi.fn(),
        };

        const chunkModel = {
            bulkCreate: vi.fn().mockResolvedValue(null),
            bulkCreateUnstructuredChunks: vi.fn().mockResolvedValue(null),
        };

        const ctx: any = {
            fileModel,
            fileService,
            asyncTaskModel,
            chunkService,
            chunkModel,
            userId: 'user-1',
        };

        // Kick off the handler but don't await it yet
        const runPromise = parseFileToChunksHandler(ctx, { fileId, taskId });

        // Advance timers to trigger timeout
        await vi.advanceTimersByTimeAsync(ASYNC_TASK_TIMEOUT);

        // Let microtasks run
        await Promise.resolve();

        // After timeout we should have updated the async task with Error at least once
        expect(asyncTaskModel.update).toHaveBeenCalled();

        // Find a call where status === AsyncTaskStatus.Error
        const hadErrorUpdate = (asyncTaskModel.update as any).mock.calls.some((args: any[]) =>
            args[1] && args[1].status === AsyncTaskStatus.Error,
        );

        expect(hadErrorUpdate).toBe(true);

        const callsAfterTimeout = (asyncTaskModel.update as any).mock.calls.length;

        // Now let the chunking resolve (late)
        resolveChunking({ chunks: [{ id: 'c1', text: 'late' }] });

        // Flush microtasks
        await Promise.resolve();

        // Ensure no additional success update happened after timeout
        expect((asyncTaskModel.update as any).mock.calls.length).toBe(callsAfterTimeout);

        // Ensure we didn't perform bulkCreate after timeout
        expect(chunkModel.bulkCreate).not.toHaveBeenCalled();

        // Clean up
        await runPromise.catch(() => { });
    });
});