import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { RequestTrigger, type VideoGenerationRoute } from '@lobechat/types';
import debug from 'debug';
import type { RuntimeVideoGenParams } from 'model-bank';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { trackProviderContentPolicyViolation } from '@/business/server/trackProviderContentPolicyViolation';
import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { notifyVideoCompleted } from '@/business/server/video-generation/notifyVideoCompleted';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { VideoGenerationService } from '@/server/services/generation/video';
import { buildVideoGenerationFilePayload } from '@/server/services/generation/videoFile';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { FileSource } from '@/types/files';
import type { VideoGenerationAsset } from '@/types/generation';

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
  previousGenerationId?: string;
  provider: string;
  route?: VideoGenerationRoute;
  userId: string;
  workspaceId?: string;
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
    previousGenerationId,
    provider,
    route,
    userId,
    workspaceId,
  } = params;

  log(
    'Starting background video polling for task: %s (provider: %s, inferenceId: %s)',
    asyncTaskId,
    provider,
    inferenceId,
  );

  let claimedByThisWorker = false;

  try {
    const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
    const videoService = new VideoGenerationService(db, userId, workspaceId);
    const generationModel = new GenerationModel(db, userId, workspaceId);

    const modelRuntime = await initModelRuntimeFromDB(db, userId, provider, workspaceId);
    const pollResult = await pollUntilCompletion(modelRuntime, inferenceId, model, route);

    if (!pollResult) {
      throw new Error('Polling completed but no video URL returned');
    }

    claimedByThisWorker = await AsyncTaskModel.claimVideoCompletion(db, asyncTaskId);
    if (!claimedByThisWorker) {
      log('Video task already claimed or finalized, skipping polling result: %s', asyncTaskId);
      return;
    }

    log('Video polling succeeded for task: %s, processing video...', asyncTaskId);

    const processResult = await videoService.processVideoForGeneration(pollResult.videoUrl, {
      headers: pollResult.headers,
    });

    const batch = await db.query.generationBatches.findFirst({
      where: (batches, { eq }) => eq(batches.id, generationBatchId),
    });

    const asset: VideoGenerationAsset = {
      coverUrl: processResult.coverKey,
      duration: processResult.duration,
      height: processResult.height,
      interactionId: inferenceId,
      originalUrl: pollResult.videoUrl.startsWith('data:') ? undefined : pollResult.videoUrl,
      previousGenerationId,
      thumbnailUrl: processResult.thumbnailKey,
      type: 'video',
      url: processResult.videoKey,
      width: processResult.width,
    };

    await generationModel.createAssetAndFile(
      generationId,
      asset,
      buildVideoGenerationFilePayload({
        generationId,
        processResult,
        prompt: batch?.prompt,
      }),
      FileSource.VideoGeneration,
    );

    const duration = Date.now() - asyncTaskCreatedAt.getTime();

    await asyncTaskModel.update(asyncTaskId, {
      duration,
      status: AsyncTaskStatus.Success,
    });

    try {
      await notifyVideoCompleted({
        generationBatchId,
        model,
        prompt: batch?.prompt ?? '',
        topicId: generationTopicId,
        userId,
      });
    } catch (error) {
      console.error('[video-background-polling] Video completion notification failed:', error);
    }

    try {
      const { resolvedModelId } = await resolveBusinessModelMapping(provider, model);
      await chargeAfterGenerate({
        computePriceParams: {
          generateAudio: (batch?.config as RuntimeVideoGenParams | undefined)?.generateAudio,
          resolution: (batch?.config as RuntimeVideoGenParams | undefined)?.resolution,
        },
        latency: duration,
        metadata: {
          asyncTaskId,
          generationBatchId,
          topicId: generationTopicId,
          ...buildMappedBusinessModelFields({
            provider,
            requestedModelId: resolvedModelId === model ? undefined : model,
            resolvedModelId,
          }),
        },
        model: resolvedModelId,
        prechargeResult,
        provider,
        usage: pollResult.usage,
        userId,
        workspaceId,
      });
    } catch (error) {
      console.error('[video-background-polling] Video completion charge failed:', error);
    }

    log('Video processing completed successfully for task: %s', asyncTaskId);
  } catch (error) {
    log('Background video polling error for task: %s', asyncTaskId, error);

    const asyncTaskModel = new AsyncTaskModel(db, userId, workspaceId);
    if (!claimedByThisWorker) {
      claimedByThisWorker = await AsyncTaskModel.claimVideoCompletion(db, asyncTaskId);
      if (!claimedByThisWorker) {
        log('Video task failure already handled by another worker: %s', asyncTaskId);
        return;
      }
    }

    const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
      error,
      provider,
      trigger: RequestTrigger.Video,
      userId,
    });
    if (providerContentPolicyMessage) {
      try {
        await trackProviderContentPolicyViolation({
          error,
          model,
          provider,
          trigger: 'video-polling',
          userId,
        });
      } catch (trackError) {
        log('Failed to track provider content policy violation: %O', trackError);
      }
    }
    await asyncTaskModel.update(asyncTaskId, {
      error: new AsyncTaskError(
        providerContentPolicyMessage
          ? AsyncTaskErrorType.ProviderContentModeration
          : AsyncTaskErrorType.ServerError,
        providerContentPolicyMessage ??
          'Background polling failed: ' +
            (error instanceof Error ? error.message : 'Unknown error'),
      ),
      status: AsyncTaskStatus.Error,
    });

    try {
      const { resolvedModelId } = await resolveBusinessModelMapping(provider, model);
      await chargeAfterGenerate({
        isError: true,
        metadata: {
          asyncTaskId,
          generationBatchId,
          topicId: generationTopicId,
          ...buildMappedBusinessModelFields({
            provider,
            requestedModelId: resolvedModelId === model ? undefined : model,
            resolvedModelId,
          }),
        },
        model: resolvedModelId,
        prechargeResult,
        provider,
        userId,
        workspaceId,
      });
    } catch (refundError) {
      console.error('[video-background-polling] Video generation refund failed:', refundError);
    }
  }
}

async function pollUntilCompletion(
  modelRuntime: any,
  inferenceId: string,
  model: string,
  route?: VideoGenerationRoute,
): Promise<{
  headers?: Record<string, string>;
  usage?: { completionTokens: number; totalTokens: number };
  videoUrl: string;
} | null> {
  const pollingInterval = 5000;
  const maxRetries = Math.ceil(ASYNC_TASK_TIMEOUT / pollingInterval);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      log('Polling attempt %d/%d for task: %s', attempt + 1, maxRetries, inferenceId);

      const result = await modelRuntime.handlePollVideoStatus(inferenceId, model, route);

      if (result.status === 'success') {
        log('Video generation succeeded for task: %s', inferenceId);
        return { headers: result.headers, usage: result.usage, videoUrl: result.videoUrl };
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
