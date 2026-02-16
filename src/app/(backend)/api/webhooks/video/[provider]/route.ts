import { timingSafeEqual } from 'node:crypto';

import { ModelRuntime } from '@lobechat/model-runtime';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  FileSource,
  type VideoGenerationAsset,
  type VideoGenerationTaskMetadata,
} from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { type RuntimeVideoGenParams } from 'model-bank';
import { NextResponse } from 'next/server';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { generationBatches } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { VideoGenerationService } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

const log = debug('lobe-video:webhook');

/** Constant-time string comparison that handles different lengths safely */
const safeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export const POST = async (req: Request, { params }: { params: Promise<{ provider: string }> }) => {
  const { provider } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  log('Received video webhook for provider: %s, body: %O', provider, body);

  let asyncTaskModel: AsyncTaskModel | undefined;
  let asyncTaskId: string | undefined;
  let asyncTaskUserId: string | undefined;
  let asyncTaskMetadata: VideoGenerationTaskMetadata | undefined;

  try {
    // Parse webhook body using provider-specific handler
    const runtime = ModelRuntime.initializeWithProvider(provider, {});
    const result = await runtime.handleCreateVideoWebhook({ body });

    if (!result) {
      return NextResponse.json(
        { error: `Provider ${provider} does not support video webhook` },
        { status: 400 },
      );
    }

    // Skip intermediate statuses (e.g. queued, running)
    if (result.status === 'pending') {
      log('Skipping intermediate status for provider: %s', provider);
      return NextResponse.json({ success: true });
    }

    log('Webhook parse result: %O', result);

    const db = await getServerDB();

    // Find asyncTask by inferenceId
    const asyncTask = await AsyncTaskModel.findByInferenceId(db, result.inferenceId);
    if (!asyncTask) {
      log('AsyncTask not found for inferenceId: %s', result.inferenceId);
      return NextResponse.json(
        { error: `AsyncTask not found for inferenceId: ${result.inferenceId}` },
        { status: 404 },
      );
    }

    // Verify webhook token to prevent forged callbacks
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    const metadata = asyncTask.metadata as VideoGenerationTaskMetadata | undefined;
    const expectedToken = metadata?.webhookToken;

    if (!expectedToken || !token || !safeCompare(token, expectedToken)) {
      log('Webhook token verification failed for asyncTask: %s', asyncTask.id);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Idempotency: skip if already in terminal state (provider may retry callbacks)
    if (
      asyncTask.status === AsyncTaskStatus.Success ||
      asyncTask.status === AsyncTaskStatus.Error
    ) {
      log('AsyncTask %s already in terminal state: %s, skipping', asyncTask.id, asyncTask.status);
      return NextResponse.json({ success: true });
    }

    const generationModel = new GenerationModel(db, asyncTask.userId);

    // Find generation by asyncTaskId
    const generation = await generationModel.findByAsyncTaskId(asyncTask.id);
    if (!generation) {
      log('Generation not found for asyncTaskId: %s', asyncTask.id);
      return NextResponse.json(
        { error: `Generation not found for asyncTaskId: ${asyncTask.id}` },
        { status: 404 },
      );
    }

    log('Found generation: %s', generation.id);

    asyncTaskModel = new AsyncTaskModel(db, asyncTask.userId);

    // Query batch to get model info for both error and success paths
    const batch = await db.query.generationBatches.findFirst({
      where: eq(generationBatches.id, generation.generationBatchId!),
    });
    const resolvedModel =
      result.status === 'success' ? (result.model ?? batch?.model ?? '') : (batch?.model ?? '');

    // Handle error result: refund precharge and mark task as error
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
            modelId: resolvedModel,
            topicId: batch?.generationTopicId,
          },
          model: resolvedModel,
          prechargeResult: metadata?.precharge as any,
          provider,
          userId: asyncTask.userId,
        });
      } catch (refundError) {
        console.error('[video-webhook] Failed to refund precharge on error:', refundError);
      }

      return NextResponse.json({ success: true });
    }

    // Handle success result: download video → process → upload S3 → create asset and file
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

    await asyncTaskModel.update(asyncTask.id, {
      status: AsyncTaskStatus.Success,
    });

    // Charge after successful video generation
    try {
      await chargeAfterGenerate({
        computePriceParams: {
          generateAudio: (batch?.config as RuntimeVideoGenParams)?.generateAudio,
        },
        latency: Date.now() - asyncTask.createdAt.getTime(),
        metadata: {
          asyncTaskId: asyncTask.id,
          generationBatchId: generation.generationBatchId!,
          modelId: resolvedModel,
          topicId: batch?.generationTopicId,
        },
        model: resolvedModel,
        prechargeResult: metadata?.precharge as any,
        provider,
        usage: result.usage,
        userId: asyncTask.userId,
      });
    } catch (chargeError) {
      console.error('[video-webhook] Failed to charge after generate:', chargeError);
    }

    log('Video webhook processing completed successfully for generation: %s', generation.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[video-webhook] Processing failed:', error);

    // Mark asyncTask as Error so the user sees failure instead of stuck "processing"
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

    // Refund precharge on unexpected failure
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

    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
