import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';
import debug from 'debug';
import { z } from 'zod';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { FileSource } from '@/types/files';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const log = debug('lobe-video:async');

const videoProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
      videoService: new VideoGenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const createVideoInputSchema = z.object({
  asyncTaskCreatedAt: z.date(),
  asyncTaskId: z.string(),
  generationBatchId: z.string(),
  generationId: z.string(),
  generationTopicId: z.string(),
  inferenceId: z.string(),
  model: z.string(),
  prechargeResult: z.any().optional(),
  provider: z.string(),
});

const checkAbortSignal = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new Error('Operation was aborted');
  }
};

async function pollUntilCompletion(
  modelRuntime: any,
  inferenceId: string,
  signal: AbortSignal,
): Promise<{ headers?: Record<string, string>; videoUrl: string } | null> {
  const maxRetries = 120;
  const pollingInterval = 5000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    checkAbortSignal(signal);

    try {
      log('Polling attempt %d/%d for inferenceId: %s', attempt + 1, maxRetries, inferenceId);

      const result = await modelRuntime.handlePollVideoStatus(inferenceId);

      if (result.status === 'success') {
        log('Video generation succeeded for inferenceId: %s', inferenceId);
        return { headers: result.headers, videoUrl: result.videoUrl };
      }

      if (result.status === 'failed') {
        throw new Error(`Video generation failed: ${result.error}`);
      }

      log('Task %s still in progress, waiting...', inferenceId);

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(resolve, pollingInterval);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId);
            reject(new Error('Operation was aborted'));
          },
          { once: true },
        );
      });
    } catch (error) {
      checkAbortSignal(signal);

      if (error instanceof Error && error.message.includes('failed')) {
        throw error;
      }

      log('Polling attempt %d failed for inferenceId: %s: %O', attempt + 1, inferenceId, error);

      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(resolve, pollingInterval);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeoutId);
            reject(new Error('Operation was aborted'));
          },
          { once: true },
        );
      });
    }
  }

  throw new Error(
    `Video generation timeout after ${maxRetries} attempts (${(maxRetries * pollingInterval) / 1000}s)`,
  );
}

export const videoRouter = router({
  createVideo: videoProcedure.input(createVideoInputSchema).mutation(async ({ input, ctx }) => {
    const {
      asyncTaskCreatedAt,
      asyncTaskId,
      generationBatchId,
      generationId,
      generationTopicId,
      inferenceId,
      model,
      prechargeResult,
      provider,
    } = input;

    log('Starting async video polling: %O', {
      asyncTaskId,
      generationId,
      inferenceId,
      model,
      provider,
    });

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const pollingPromise = async (signal: AbortSignal) => {
        const asyncTaskModel = ctx.asyncTaskModel;
        const generationModel = ctx.generationModel;
        const videoService = ctx.videoService;

        log('Initializing agent runtime for provider: %s', provider);
        const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);

        checkAbortSignal(signal);

        const pollResult = await pollUntilCompletion(modelRuntime, inferenceId, signal);

        if (!pollResult) {
          log('Polling completed but no video URL returned for inferenceId: %s', inferenceId);
          throw new Error('Polling completed but no video URL returned');
        }

        log('Video polling succeeded for task: %s, processing video...', asyncTaskId);

        const processResult = await videoService.processVideoForGeneration(pollResult.videoUrl, {
          headers: pollResult.headers,
        });

        log('Video processed successfully, creating asset and file');

        const batch = await ctx.serverDB.query.generationBatches.findFirst({
          where: (batches, { eq }) => eq(batches.id, generationBatchId),
        });

        await generationModel.createAssetAndFile(
          generationId,
          {
            coverUrl: processResult.coverKey,
            duration: processResult.duration,
            height: processResult.height,
            originalUrl: pollResult.videoUrl,
            thumbnailUrl: processResult.thumbnailKey,
            type: 'video',
            url: processResult.videoKey,
            width: processResult.width,
          },
          {
            fileHash: processResult.fileHash,
            fileType: processResult.mimeType,
            name: `${sanitizeFileName(batch?.prompt ?? '', generationId)}.mp4`,
            size: processResult.fileSize,
            url: processResult.videoKey,
          },
          FileSource.VideoGeneration,
        );

        log('Asset and file created successfully for generation: %s', generationId);

        const duration = Date.now() - asyncTaskCreatedAt.getTime();

        log('Updating task status to Success: %s, duration: %dms', asyncTaskId, duration);
        await asyncTaskModel.update(asyncTaskId, {
          duration,
          status: AsyncTaskStatus.Success,
        });

        if (ENABLE_BUSINESS_FEATURES && prechargeResult) {
          try {
            await chargeAfterGenerate({
              computePriceParams: {
                generateAudio: (batch?.config as any)?.generateAudio,
              },
              latency: duration,
              metadata: {
                asyncTaskId,
                generationBatchId,
                modelId: model,
                topicId: generationTopicId,
              },
              model,
              prechargeResult,
              provider,
              usage: undefined,
              userId: ctx.userId,
            });
            log('Charge completed successfully for asyncTask: %s', asyncTaskId);
          } catch (chargeError) {
            console.error('[video-async] Failed to charge after generate:', chargeError);
          }
        }

        log('Async video generation completed successfully: %s', asyncTaskId);
        return { success: true };
      };

      timeoutId = setTimeout(() => {
        log('Video generation timeout, aborting operation: %s', asyncTaskId);
        abortController.abort();
      }, ASYNC_TASK_TIMEOUT);

      const result = await pollingPromise(abortController.signal);

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      return result;
    } catch (error: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      log('Async video generation failed: %O', {
        asyncTaskId,
        error: error.message || error,
        generationId,
        inferenceId,
      });

      await ctx.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.ServerError,
          'Background polling failed: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
        ),
        status: AsyncTaskStatus.Error,
      });

      log('Task status updated to Error: %s', asyncTaskId);

      if (prechargeResult && ENABLE_BUSINESS_FEATURES) {
        try {
          await chargeAfterGenerate({
            isError: true,
            metadata: {
              asyncTaskId,
              generationBatchId,
              modelId: model,
              topicId: generationTopicId,
            },
            model,
            prechargeResult,
            provider,
            userId: ctx.userId,
          });
          log('Precharge refunded successfully for asyncTask: %s', asyncTaskId);
        } catch (refundError) {
          console.error('[video-async] Failed to refund precharge on error:', refundError);
        }
      }

      return {
        message: `Video generation ${asyncTaskId} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        success: false,
      };
    }
  }),
});
