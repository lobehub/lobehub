import { timingSafeEqual } from 'node:crypto';

import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import type { VideoGenerationAsset, VideoGenerationTaskMetadata } from '@lobechat/types';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus, FileSource } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import type { RuntimeVideoGenParams } from 'model-bank';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { notifyVideoCompleted } from '@/business/server/video-generation/notifyVideoCompleted';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { generationBatches } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { VideoGenerationService } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const log = debug('lobe-video:webhook');

const safeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export interface VideoWebhookParams {
  provider: string;
}

export const videoWebhookAPIHandler = async (request: Request, params: VideoWebhookParams) => {
  const { provider } = params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  log('Received video webhook for provider: %s, body: %O', provider, body);

  let asyncTaskModel: AsyncTaskModel | undefined;
  let asyncTaskId: string | undefined;
  let asyncTaskUserId: string | undefined;
  let asyncTaskMetadata: VideoGenerationTaskMetadata | undefined;

  try {
    const runtime = ModelRuntime.initializeWithProvider(provider, {
      apiKey: 'webhook-placeholder',
    });
    const result = await runtime.handleCreateVideoWebhook({ body });

    if (!result) {
      return Response.json(
        { error: `Provider ${provider} does not support video webhook` },
        { status: 400 },
      );
    }

    if (result.status === 'pending') {
      log('Skipping intermediate status for provider: %s', provider);
      return Response.json({ success: true });
    }

    log('Webhook parse result: %O', result);

    const db = await getServerDB();

    const asyncTask = await AsyncTaskModel.findByInferenceId(db, result.inferenceId);
    if (!asyncTask) {
      log('AsyncTask not found for inferenceId: %s', result.inferenceId);
      return Response.json(
        { error: `AsyncTask not found for inferenceId: ${result.inferenceId}` },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const metadata = asyncTask.metadata as VideoGenerationTaskMetadata | undefined;
    const expectedToken = metadata?.webhookToken;

    if (!expectedToken || !token || !safeCompare(token, expectedToken)) {
      log('Webhook token verification failed for asyncTask: %s', asyncTask.id);
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    log('Webhook token verified for asyncTask: %s', asyncTask.id);

    asyncTaskId = asyncTask.id;
    asyncTaskUserId = asyncTask.userId;
    asyncTaskMetadata = metadata;

    log(
      'Found asyncTask: %s, userId: %s, status: %s',
      asyncTask.id,
      asyncTask.userId,
      asyncTask.status,
    );

    if (
      asyncTask.status === AsyncTaskStatus.Success ||
      asyncTask.status === AsyncTaskStatus.Error
    ) {
      log('AsyncTask %s already in terminal state: %s, skipping', asyncTask.id, asyncTask.status);
      return Response.json({ success: true });
    }

    const generationModel = new GenerationModel(db, asyncTask.userId);

    const generation = await generationModel.findByAsyncTaskId(asyncTask.id);
    if (!generation) {
      log('Generation not found for asyncTaskId: %s', asyncTask.id);
      return Response.json(
        { error: `Generation not found for asyncTaskId: ${asyncTask.id}` },
        { status: 404 },
      );
    }

    log('Found generation: %s', generation.id);

    asyncTaskModel = new AsyncTaskModel(db, asyncTask.userId);

    const batch = await db.query.generationBatches.findFirst({
      where: eq(generationBatches.id, generation.generationBatchId!),
    });
    const requestedModel = batch?.model ?? '';
    const { resolvedModelId } = requestedModel
      ? await resolveBusinessModelMapping(provider, requestedModel)
      : { resolvedModelId: '' };

    const mappedModelFields = buildMappedBusinessModelFields({
      provider,
      requestedModelId: resolvedModelId === requestedModel ? undefined : requestedModel,
      resolvedModelId,
    });

    if (result.status === 'error') {
      log('Video generation failed: %s', result.error);
      await asyncTaskModel.update(asyncTask.id, {
        error: new AsyncTaskError(AsyncTaskErrorType.ServerError, result.error),
        status: AsyncTaskStatus.Error,
      });

      try {
        await chargeAfterGenerate({
          isError: true,
          metadata: {
            asyncTaskId: asyncTask.id,
            generationBatchId: generation.generationBatchId!,
            topicId: batch?.generationTopicId,
            ...mappedModelFields,
          },
          model: resolvedModelId,
          prechargeResult: metadata?.precharge as any,
          provider,
          userId: asyncTask.userId,
        });
      } catch (refundError) {
        console.error('[video-webhook] Failed to refund precharge on error:', refundError);
      }

      return Response.json({ success: true });
    }

    const videoService = new VideoGenerationService(db, asyncTask.userId);
    const processResult = await videoService.processVideoForGeneration(result.videoUrl);

    const asset: VideoGenerationAsset = {
      coverUrl: processResult.coverKey,
      duration: processResult.duration,
      height: processResult.height,
      originalUrl: result.videoUrl,
      thumbnailUrl: processResult.thumbnailKey,
      type: 'video',
      url: processResult.videoKey,
      width: processResult.width,
    };

    await generationModel.createAssetAndFile(
      generation.id,
      asset,
      {
        fileHash: processResult.fileHash,
        fileType: processResult.mimeType,
        name: `${sanitizeFileName(batch?.prompt ?? '', generation.id)}.mp4`,
        size: processResult.fileSize,
        url: processResult.videoKey,
      },
      FileSource.VideoGeneration,
    );

    const duration = Date.now() - asyncTask.createdAt.getTime();

    await asyncTaskModel.update(asyncTask.id, {
      duration,
      status: AsyncTaskStatus.Success,
    });

    try {
      await notifyVideoCompleted({
        generationBatchId: generation.generationBatchId!,
        model: requestedModel,
        prompt: batch?.prompt ?? '',
        topicId: batch?.generationTopicId,
        userId: asyncTask.userId,
      });
    } catch (err) {
      console.error('[video-webhook] notification failed:', err);
    }

    try {
      await chargeAfterGenerate({
        computePriceParams: {
          generateAudio: (batch?.config as RuntimeVideoGenParams)?.generateAudio,
          resolution: (batch?.config as RuntimeVideoGenParams)?.resolution,
        },
        latency: duration,
        metadata: {
          asyncTaskId: asyncTask.id,
          generationBatchId: generation.generationBatchId!,
          topicId: batch?.generationTopicId,
          ...mappedModelFields,
        },
        model: resolvedModelId,
        prechargeResult: metadata?.precharge as any,
        provider,
        usage: result.usage,
        userId: asyncTask.userId,
      });
    } catch (chargeError) {
      console.error('[video-webhook] Failed to charge after generate:', chargeError);
    }

    log('Video webhook processing completed successfully for generation: %s', generation.id);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[video-webhook] Processing failed:', error);

    if (asyncTaskModel && asyncTaskId) {
      try {
        await asyncTaskModel.update(asyncTaskId, {
          error: new AsyncTaskError(AsyncTaskErrorType.ServerError, (error as Error).message),
          status: AsyncTaskStatus.Error,
        });
      } catch (updateError) {
        console.error('[video-webhook] Failed to update asyncTask status:', updateError);
      }
    }

    if (asyncTaskUserId && asyncTaskMetadata?.precharge) {
      try {
        await chargeAfterGenerate({
          isError: true,
          metadata: { asyncTaskId: asyncTaskId ?? '', generationBatchId: '', modelId: '' },
          model: '',
          prechargeResult: asyncTaskMetadata.precharge as any,
          provider,
          userId: asyncTaskUserId,
        });
      } catch (refundError) {
        console.error('[video-webhook] Failed to refund precharge on failure:', refundError);
      }
    }

    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};
