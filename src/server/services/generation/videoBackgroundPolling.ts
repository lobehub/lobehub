import debug from 'debug';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { FileSource } from '@/types/files';
import type { VideoGenerationAsset } from '@/types/generation';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const log = debug('lobe-video:background-polling');

interface BackgroundPollingParams {
  asyncTaskCreatedAt: Date;
  asyncTaskId: string;
  generationBatchId: string;
  generationId: string;
  generationTopicId: string;
  inferenceId: string;
  model: string;
  prechargeResult?: any;
  provider: string;
  userId: string;
}

export async function processBackgroundVideoPolling(
  db: LobeChatDatabase,
  params: BackgroundPollingParams,
): Promise<void> {
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
    userId,
  } = params;

  log(
    'Starting background video polling for task: %s (provider: %s, inferenceId: %s)',
    asyncTaskId,
    provider,
    inferenceId,
  );

  try {
    const asyncTaskModel = new AsyncTaskModel(db, userId);
    const videoService = new VideoGenerationService(db, userId);
    const generationModel = new GenerationModel(db, userId);

    const modelRuntime = await initModelRuntimeFromDB(db, userId, provider);
    const pollResult = await pollUntilCompletion(modelRuntime, inferenceId);

    if (!pollResult) {
      throw new Error('Polling completed but no video URL returned');
    }

    log('Video polling succeeded for task: %s, processing video...', asyncTaskId);

    const processResult = await videoService.processVideoForGeneration(pollResult.videoUrl, {
      headers: pollResult.headers,
    });

    const asset: VideoGenerationAsset = {
      coverUrl: processResult.coverKey,
      duration: processResult.duration,
      height: processResult.height,
      originalUrl: pollResult.videoUrl,
      thumbnailUrl: processResult.thumbnailKey,
      type: 'video',
      url: processResult.videoKey,
      width: processResult.width,
    };

    const batch = await db.query.generationBatches.findFirst({
      where: (batches, { eq }) => eq(batches.id, generationBatchId),
    });

    await generationModel.createAssetAndFile(
      generationId,
      asset,
      {
        fileHash: processResult.fileHash,
        fileType: processResult.mimeType,
        name: `${sanitizeFileName(batch?.prompt ?? '', generationId)}.mp4`,
        size: processResult.fileSize,
        url: processResult.videoKey,
      },
      FileSource.VideoGeneration,
    );

    const duration = Date.now() - asyncTaskCreatedAt.getTime();

    await asyncTaskModel.update(asyncTaskId, {
      duration,
      status: AsyncTaskStatus.Success,
    });

    log('Video processing completed successfully for task: %s', asyncTaskId);
  } catch (error) {
    log('Background video polling error for task: %s', asyncTaskId, error);

    const asyncTaskModel = new AsyncTaskModel(db, userId);
    await asyncTaskModel.update(asyncTaskId, {
      error: new AsyncTaskError(
        AsyncTaskErrorType.ServerError,
        'Background polling failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      ),
      status: AsyncTaskStatus.Error,
    });
  }
}

async function pollUntilCompletion(
  modelRuntime: any,
  inferenceId: string,
): Promise<{ headers?: Record<string, string>; videoUrl: string } | null> {
  const maxRetries = 120;
  const pollingInterval = 5000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log('Polling attempt %d/%d for task: %s', attempt + 1, maxRetries, inferenceId);

      const result = await modelRuntime.handlePollVideoStatus(inferenceId);

      if (result.status === 'success') {
        log('Video generation succeeded for task: %s', inferenceId);
        return { headers: result.headers, videoUrl: result.videoUrl };
      }

      if (result.status === 'failed') {
        throw new Error(`Video generation failed: ${result.error}`);
      }

      log('Task %s still in progress', inferenceId);
      await sleep(pollingInterval);
    } catch (error) {
      if (error instanceof Error && error.message.includes('failed')) {
        throw error;
      }
      log('Polling attempt %d failed for task: %s: %O', attempt + 1, inferenceId, error);
      await sleep(pollingInterval);
    }
  }

  throw new Error(
    `Video generation timeout after ${maxRetries} attempts (${(maxRetries * pollingInterval) / 1000}s)`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
