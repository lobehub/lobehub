import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { type CreateImageMethodOptions } from '@lobechat/model-runtime';
import { AsyncTaskError, AsyncTaskStatus, RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { type RuntimeImageGenParams } from 'model-bank';
import { z } from 'zod';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import { createImageBusinessMiddleware } from '@/business/server/trpc-middlewares/async';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { categorizeImageGenerationError } from './imageError';

const log = debug('lobe-image:async');

const IMAGE_URL_PREVIEW_LENGTH = 100;

const imageProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const createImageInputSchema = z.object({
  generationBatchId: z.string(),
  generationId: z.string(),
  generationTopicId: z.string(),
  model: z.string(),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string(),
      seed: z.number().nullish(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string(),
  taskId: z.string(),
  workspaceId: z.string().optional(),
});

/**
 * Checks if the abort signal has been triggered and throws an error if so
 */
const checkAbortSignal = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new Error('Operation was aborted');
  }
};

export const imageRouter = router({
  createImage: imageProcedure
    .use(createImageBusinessMiddleware)
    .input(createImageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        taskId,
        generationId,
        generationBatchId,
        generationTopicId,
        provider,
        model,
        params,
        workspaceId,
      } = input;
      const asyncTaskModel = new AsyncTaskModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationBatchModel = new GenerationBatchModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationModel = new GenerationModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationService = new GenerationService(ctx.serverDB, ctx.userId, workspaceId);

      log('Starting async image generation: %O', {
        generationId,
        imageParams: {
          cfg: params.cfg,
          height: params.height,
          steps: params.steps,
          width: params.width,
        },
        model,
        prompt: params.prompt,
        provider,
        taskId,
      });

      // Check if generationBatch exists before processing
      const generationBatch = await generationBatchModel.findById(generationBatchId);
      if (!generationBatch) {
        log('Generation batch not found: %s, skipping image generation', generationBatchId);
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid Request!' });
      }

      // Billing context is loaded inside the guarded section below so that a
      // failure (e.g. a stale model mapping) still marks the task as Error and
      // reconciles the precharge handle; the error path falls back to identity
      // mapping when resolution itself is what failed.
      // requestedModelId is optional on the mapping result, so it must allow
      // undefined even though it defaults to the raw model id.
      let requestedModelId: string | undefined = model;
      let resolvedModelId = model;
      let prechargeResult: unknown;

      log('Updating task status to Processing: %s', taskId);
      await asyncTaskModel.update(taskId, { status: AsyncTaskStatus.Processing });

      // Use AbortController to prevent resource leaks
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const isEditingImage =
        Boolean((params as any).imageUrl) ||
        Boolean(params.imageUrls && params.imageUrls.length > 0);

      try {
        // Opaque billing handle stored on the task at submission time; threaded
        // to the completion charge so it can reconcile the pre-submission
        // billing. Loaded before the model mapping so the handle is available
        // for reconciliation even when mapping resolution throws.
        const asyncTask = await asyncTaskModel.findById(taskId);
        prechargeResult = (asyncTask?.metadata as { precharge?: unknown } | undefined)?.precharge;

        // Resolve model mapping up front so both the success and error billing
        // paths can reference the resolved model id.
        ({ requestedModelId, resolvedModelId } = await resolveBusinessModelMapping(
          provider,
          model,
        ));

        const imageGenerationPromise = async (signal: AbortSignal) => {
          log('Initializing agent runtime for provider: %s', provider);

          // Read user's provider config from database
          const modelRuntime = await initModelRuntimeFromDB(
            ctx.serverDB,
            ctx.userId,
            provider,
            workspaceId,
          );

          // Check if operation has been cancelled
          checkAbortSignal(signal);
          log('Agent runtime initialized, calling createImage');
          const runtimeOptions: CreateImageMethodOptions = {
            metadata: {
              generationBatchId,
              generationId,
              taskId,
              trigger: RequestTrigger.Image,
            },
          };
          const response = await modelRuntime.createImage!(
            {
              model: resolvedModelId,
              params: params as unknown as RuntimeImageGenParams,
            },
            runtimeOptions,
          );

          if (!response) {
            log('Create image response is empty');
            throw new Error('Create image response is empty');
          }

          log('Create image response: %O', {
            ...response,
            imageUrl: response.imageUrl?.startsWith('data:')
              ? response.imageUrl.slice(0, IMAGE_URL_PREVIEW_LENGTH) + '...'
              : response.imageUrl,
          });

          const { modelUsage } = response;

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Image generation successful: %O', {
            height: response.height,
            imageUrl: response.imageUrl.startsWith('data:')
              ? response.imageUrl.slice(0, IMAGE_URL_PREVIEW_LENGTH) + '...'
              : response.imageUrl,
            width: response.width,
          });

          log('Transforming image for generation');
          const { imageUrl, width, height } = response;

          // Extract ComfyUI authentication headers if provider is ComfyUI
          let authHeaders: Record<string, string> | undefined;
          if (provider === 'comfyui') {
            // Use the public interface method to get auth headers
            // This avoids accessing private members and exposing credentials
            authHeaders = modelRuntime.getAuthHeaders();
            if (authHeaders) {
              log('Using authentication headers for ComfyUI image download');
            } else {
              log('No authentication configured for ComfyUI');
            }
          }

          const { image, thumbnailImage } = await generationService.transformImageForGeneration(
            imageUrl,
            authHeaders,
          );

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Uploading image for generation');
          const { imageUrl: uploadedImageUrl, thumbnailImageUrl } =
            await generationService.uploadImageForGeneration(image, thumbnailImage);

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Updating generation asset and file');
          await generationModel.createAssetAndFile(
            generationId,
            {
              height: height ?? image.height,
              // If imageUrl is base64 data, use uploadedImageUrl instead to avoid storing large base64 in DB
              originalUrl: imageUrl.startsWith('data:') ? uploadedImageUrl : imageUrl,
              thumbnailUrl: thumbnailImageUrl,
              type: 'image',
              url: uploadedImageUrl,
              width: width ?? image.width,
            },
            {
              fileHash: image.hash,
              fileType: image.mime,
              metadata: {
                generationId,
                height: image.height,
                path: uploadedImageUrl,
                width: image.width,
              },
              name: `${sanitizeFileName(params.prompt, generationId)}.${image.extension}`,
              size: image.size,
              url: uploadedImageUrl,
            },
          );

          const duration = Date.now() - generationBatch.createdAt.getTime();

          log('Updating task status to Success: %s, duration: %dms', taskId, duration);
          await asyncTaskModel.update(taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          try {
            await notifyImageCompleted({
              duration,
              generationBatchId,
              model,
              prompt: params.prompt,
              topicId: generationTopicId,
              userId: ctx.userId,
            });
          } catch (err) {
            console.error('[image-async] notification failed:', err);
          }

          if (ENABLE_BUSINESS_FEATURES) {
            // Contain success-billing errors: the image is already delivered and
            // the task marked Success, so a billing failure here must not fall
            // into the outer catch and be reconciled as a generation failure.
            try {
              await chargeAfterGenerate({
                metrics: { latency: duration },
                metadata: {
                  asyncTaskId: taskId,
                  generationBatchId,
                  topicId: generationTopicId,
                  ...buildMappedBusinessModelFields({
                    provider,
                    requestedModelId,
                    resolvedModelId,
                  }),
                },
                modelUsage,
                prechargeResult,
                pricingContext: runtimeOptions.pricingContext,
                provider,
                userId: ctx.userId,
                workspaceId,
              });
            } catch (chargeError) {
              console.error('[image-async] success billing failed:', chargeError);
            }
          }

          log('Async image generation completed successfully: %s', taskId);
          return { success: true };
        };

        // Set timeout to cancel operation and prevent resource leaks
        timeoutId = setTimeout(() => {
          log('Image generation timeout, aborting operation: %s', taskId);
          abortController.abort();
        }, ASYNC_TASK_TIMEOUT);

        const result = await imageGenerationPromise(abortController.signal);

        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        return result;
      } catch (error: any) {
        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        log('Async image generation failed: %O', {
          error: error.message || error,
          generationId,
          taskId,
        });

        // Improved error categorization logic
        const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
          error,
          provider,
          trigger: RequestTrigger.Image,
          userId: ctx.userId,
        });
        const { errorType, errorMessage } = categorizeImageGenerationError({
          error,
          isEditingImage,
          isAborted: abortController.signal.aborted,
          providerContentPolicyMessage,
        });

        await asyncTaskModel.update(taskId, {
          error: new AsyncTaskError(errorType, errorMessage),
          status: AsyncTaskStatus.Error,
        });

        log('Task status updated to Error: %s, errorType: %s', taskId, errorType);

        // Reconcile the pre-submission billing on failure. Wrapped so a billing
        // error never masks the original failure report.
        if (ENABLE_BUSINESS_FEATURES) {
          try {
            await chargeAfterGenerate({
              isError: true,
              metadata: {
                asyncTaskId: taskId,
                generationBatchId,
                topicId: generationTopicId,
                ...buildMappedBusinessModelFields({
                  provider,
                  requestedModelId,
                  resolvedModelId,
                }),
              },
              prechargeResult,
              provider,
              userId: ctx.userId,
              workspaceId,
            });
          } catch (chargeError) {
            console.error('[image-async] Failed to reconcile billing on error:', chargeError);
          }
        }

        return {
          message: `Image generation ${taskId} failed: ${errorMessage}`,
          success: false,
        };
      }
    }),
});
