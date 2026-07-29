import { timingSafeEqual } from 'node:crypto';

import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  FileSource,
  type VideoGenerationAsset,
  type VideoGenerationTaskMetadata,
} from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';
import debug from 'debug';
import { eq } from 'drizzle-orm';
import { type RuntimeVideoGenParams } from 'model-bank';
import { NextResponse } from 'next/server';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { notifyVideoCompleted } from '@/business/server/video-generation/notifyVideoCompleted';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { generationBatches } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
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
  let rawBody: string;
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  log('Received video webhook for provider: %s, body: %O', provider, body);

  let asyncTaskModel: AsyncTaskModel | undefined;
  let asyncTaskId: string | undefined;
  let asyncTaskUserId: string | undefined;
  let asyncTaskWorkspaceId: string | undefined;
  let asyncTaskMetadata: VideoGenerationTaskMetadata | undefined;

  try {
    const runtime = ModelRuntime.initializeWithProvider(provider, {
      apiKey: 'webhook-placeholder',
    });
    const url = new URL(req.url);
    const webhookResult = await runtime.handleCreateVideoWebhook({
      body,
      headers: Object.fromEntries(req.headers.entries()),
      model: url.searchParams.get('model') ?? undefined,
      rawBody,
      url: req.url,
    });

    if (!webhookResult) {
      return NextResponse.json(
        { error: `Provider ${provider} does not support video webhook` },
        { status: 400 },
      );
    }

    // Skip intermediate statuses (e.g. queued, running)
    if (webhookResult.status === 'pending') {
      log('Skipping intermediate status for provider: %s', provider);
      return NextResponse.json({ success: true });
    }

    log('Webhook parse result: %O', webhookResult);

    const db = await getServerDB();

    // Find asyncTask by inferenceId
    const asyncTask = await AsyncTaskModel.findByInferenceId(db, webhookResult.inferenceId);
    if (!asyncTask) {
      log('AsyncTask not found for inferenceId: %s', webhookResult.inferenceId);
      return NextResponse.json(
        { error: `AsyncTask not found for inferenceId: ${webhookResult.inferenceId}` },
        { status: 404 },
      );
    }

    // Verify webhook token to prevent forged callbacks
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
    asyncTaskWorkspaceId = asyncTask.workspaceId ?? undefined;
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

    const generationModel = new GenerationModel(
      db,
      asyncTask.userId,
      asyncTask.workspaceId ?? undefined,
    );

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

    asyncTaskModel = new AsyncTaskModel(db, asyncTask.userId, asyncTask.workspaceId ?? undefined);

    // Query batch to get model info for both error and success paths
    const batch = await db.query.generationBatches.findFirst({
      where: eq(generationBatches.id, generation.generationBatchId!),
    });
    const requestedModel = batch?.model ?? '';
    // Resolve mapping so spend log metadata and pricing lookup use the billed model id,
    // not the user-facing alias nor the provider-reported internal name.
    const { resolvedModelId } = requestedModel
      ? await resolveBusinessModelMapping(provider, requestedModel)
      : { resolvedModelId: '' };

    const mappedModelFields = buildMappedBusinessModelFields({
      provider,
      requestedModelId: resolvedModelId === requestedModel ? undefined : requestedModel,
      resolvedModelId,
    });

    let result:
      | {
          error: string;
          inferenceId: string;
          status: 'error';
        }
      | {
          headers?: Record<string, string>;
          inferenceId: string;
          status: 'success';
          usage?: { completionTokens: number; totalTokens: number };
          videoUrl: string;
        };

    if (webhookResult.status === 'completed') {
      const userRuntime = await initModelRuntimeFromDB(
        db,
        asyncTask.userId,
        provider,
        asyncTask.workspaceId ?? undefined,
      );
      const pollResult = await userRuntime.handlePollVideoStatus(
        webhookResult.inferenceId,
        requestedModel,
        metadata?.route,
      );

      if (!pollResult) {
        throw new Error(`Provider ${provider} does not support video polling`);
      }

      if (pollResult.status === 'pending') {
        log(
          'Interaction completed but generated video file is still processing: %s',
          webhookResult.inferenceId,
        );
        return NextResponse.json(
          { error: 'Generated video file is still processing' },
          { status: 503 },
        );
      }

      const pollHeaders =
        'headers' in pollResult && isRecord(pollResult.headers)
          ? Object.fromEntries(
              Object.entries(pollResult.headers).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            )
          : undefined;

      result =
        pollResult.status === 'failed'
          ? {
              error: pollResult.error,
              inferenceId: webhookResult.inferenceId,
              status: 'error',
            }
          : {
              headers: pollHeaders,
              inferenceId: webhookResult.inferenceId,
              status: 'success',
              usage: pollResult.usage,
              videoUrl: pollResult.videoUrl,
            };
    } else {
      result = webhookResult;
    }

    const claimed = await AsyncTaskModel.claimVideoCompletion(
      db,
      asyncTask.id,
      req.headers.get('webhook-id') ?? undefined,
    );
    if (!claimed) {
      log('AsyncTask %s completion already claimed, skipping duplicate webhook', asyncTask.id);
      return NextResponse.json({ success: true });
    }

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
            topicId: batch?.generationTopicId,
            ...mappedModelFields,
          },
          model: resolvedModelId,
          prechargeResult: metadata?.precharge as any,
          provider,
          userId: asyncTask.userId,
          workspaceId: asyncTask.workspaceId ?? undefined,
        });
      } catch (refundError) {
        console.error('[video-webhook] Failed to refund precharge on error:', refundError);
      }

      return NextResponse.json({ success: true });
    }

    // Handle success result: download video → process → upload S3 → create asset and file
    const videoService = new VideoGenerationService(
      db,
      asyncTask.userId,
      asyncTask.workspaceId ?? undefined,
    );
    const processResult = await videoService.processVideoForGeneration(result.videoUrl, {
      headers: result.headers,
    });

    const asset: VideoGenerationAsset = {
      coverUrl: processResult.coverKey,
      duration: processResult.duration,
      height: processResult.height,
      interactionId: result.inferenceId,
      originalUrl: result.videoUrl.startsWith('data:') ? undefined : result.videoUrl,
      previousGenerationId: metadata?.previousGenerationId,
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
        workspaceId: asyncTask.workspaceId ?? undefined,
      });
    } catch (err) {
      console.error('[video-webhook] notification failed:', err);
    }

    // Charge after successful video generation
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
        workspaceId: asyncTask.workspaceId ?? undefined,
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
          workspaceId: asyncTaskWorkspaceId,
        });
      } catch (refundError) {
        console.error('[video-webhook] Failed to refund precharge on failure:', refundError);
      }
    }

    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
