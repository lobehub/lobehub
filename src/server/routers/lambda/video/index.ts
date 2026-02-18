import { randomBytes } from 'node:crypto';

import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { chargeBeforeGenerate } from '@/business/server/video-generation/chargeBeforeGenerate';
import { getVideoFreeQuota } from '@/business/server/video-generation/getVideoFreeQuota';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import {
  asyncTasks,
  generationBatches,
  generations,
  type NewGeneration,
  type NewGenerationBatch,
} from '@/database/schemas';
import { appEnv } from '@/envs/app';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { FileService } from '@/server/services/file';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

const log = debug('lobe-video:lambda');

const videoProcedure = authedProcedure
  .use(keyVaults)
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;

    return opts.next({
      ctx: {
        asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
        fileService: new FileService(ctx.serverDB, ctx.userId),
      },
    });
  });

const createVideoInputSchema = z.object({
  generationTopicId: z.string(),
  model: z.string(),
  params: z
    .object({
      aspectRatio: z.string().optional(),
      cameraFixed: z.boolean().optional(),
      duration: z.number().optional(),
      endImageUrl: z.string().nullable().optional(),
      generateAudio: z.boolean().optional(),
      imageUrl: z.string().nullable().optional(),
      prompt: z.string(),
      resolution: z.string().optional(),
      seed: z.number().nullable().optional(),
    })
    .passthrough(),
  provider: z.string(),
});
export type CreateVideoServicePayload = z.infer<typeof createVideoInputSchema>;

export const videoRouter = router({
  createVideo: videoProcedure.input(createVideoInputSchema).mutation(async ({ input, ctx }) => {
    const { userId, serverDB, asyncTaskModel, fileService } = ctx;
    const { generationTopicId, provider, model, params } = input;

    log('Starting video creation process, input: %O', input);

    // Normalize image URLs to S3 keys for database storage
    let configForDatabase = { ...params };

    // Process first-frame imageUrl
    if (typeof params.imageUrl === 'string' && params.imageUrl) {
      try {
        const key = await fileService.getKeyFromFullUrl(params.imageUrl);
        if (key) {
          log('Converted imageUrl to key: %s -> %s', params.imageUrl, key);
          configForDatabase = { ...configForDatabase, imageUrl: key };
        }
      } catch (error) {
        console.error('Error converting imageUrl to key: %O', error);
      }
    }

    // Process last-frame endImageUrl
    if (typeof params.endImageUrl === 'string' && params.endImageUrl) {
      try {
        const key = await fileService.getKeyFromFullUrl(params.endImageUrl);
        if (key) {
          log('Converted endImageUrl to key: %s -> %s', params.endImageUrl, key);
          configForDatabase = { ...configForDatabase, endImageUrl: key };
        }
      } catch (error) {
        console.error('Error converting endImageUrl to key: %O', error);
      }
    }

    // In development, convert localhost proxy URLs to S3 URLs for API access
    let generationParams = params;
    if (process.env.NODE_ENV === 'development') {
      const updates: Record<string, unknown> = {};

      if (typeof params.imageUrl === 'string' && params.imageUrl) {
        const s3Url = await fileService.getFullFileUrl(configForDatabase.imageUrl as string);
        if (s3Url) {
          log('Dev: converted imageUrl proxy URL to S3 URL: %s -> %s', params.imageUrl, s3Url);
          updates.imageUrl = s3Url;
        }
      }

      if (typeof params.endImageUrl === 'string' && params.endImageUrl) {
        const s3Url = await fileService.getFullFileUrl(configForDatabase.endImageUrl as string);
        if (s3Url) {
          log(
            'Dev: converted endImageUrl proxy URL to S3 URL: %s -> %s',
            params.endImageUrl,
            s3Url,
          );
          updates.endImageUrl = s3Url;
        }
      }

      if (Object.keys(updates).length > 0) {
        generationParams = { ...params, ...updates };
      }
    }

    // Step 0: Pre-charge (atomic budget deduction to prevent concurrent abuse)
    const { errorBatch, prechargeResult } = await chargeBeforeGenerate({
      generationTopicId,
      model,
      params,
      provider,
      userId,
    });
    if (errorBatch) return errorBatch;

    // Generate a one-time token for webhook callback verification
    const webhookToken = randomBytes(32).toString('hex');

    // Step 1: Atomically create all database records in a transaction
    const {
      batch: createdBatch,
      generation: createdGeneration,
      asyncTaskId,
    } = await serverDB.transaction(async (tx) => {
      log('Starting database transaction for video generation');

      // 1. Create generationBatch
      const newBatch: NewGenerationBatch = {
        config: configForDatabase,
        generationTopicId,
        model,
        prompt: params.prompt,
        provider,
        userId,
      };
      log('Creating generation batch: %O', newBatch);
      const [batch] = await tx.insert(generationBatches).values(newBatch).returning();
      log('Generation batch created: %s', batch.id);

      // 2. Create single generation (video is always 1)
      const newGeneration: NewGeneration = {
        generationBatchId: batch.id,
        seed: params.seed ?? null,
        userId,
      };
      const [generation] = await tx.insert(generations).values(newGeneration).returning();
      log('Generation created: %s', generation.id);

      // 3. Create asyncTask with precharge metadata
      const [asyncTask] = await tx
        .insert(asyncTasks)
        .values({
          metadata: {
            ...(prechargeResult ? { precharge: prechargeResult } : {}),
            webhookToken,
          },
          status: AsyncTaskStatus.Pending,
          type: AsyncTaskType.VideoGeneration,
          userId,
        })
        .returning();
      log('Async task created: %s', asyncTask.id);

      // 4. Link asyncTask to generation
      await tx
        .update(generations)
        .set({ asyncTaskId: asyncTask.id })
        .where(and(eq(generations.id, generation.id), eq(generations.userId, userId)));

      return {
        asyncTaskId: asyncTask.id,
        batch,
        generation,
      };
    });

    log('Database transaction completed. Calling model runtime for video generation.');

    // Step 2: Call model runtime to submit video generation task
    try {
      const modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider);

      const callbackBaseUrl = process.env.WEBHOOK_PROXY_URL || appEnv.APP_URL;
      const callbackUrl = `${callbackBaseUrl}/api/webhooks/video/${provider}?token=${webhookToken}`;
      log('Using callback URL: %s', callbackUrl);

      const response = await modelRuntime.createVideo({
        callbackUrl,
        model,
        params: generationParams,
      });

      log('Video task submitted successfully, inferenceId: %s', response?.inferenceId);

      // Update asyncTask with inferenceId and set status to Processing
      await asyncTaskModel.update(asyncTaskId, {
        inferenceId: response?.inferenceId,
        status: AsyncTaskStatus.Processing,
      });
    } catch (e) {
      console.error('Failed to submit video generation task:', e);

      await asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'Failed to submit video task: ' + (e instanceof Error ? e.message : 'Unknown error'),
        ),
        status: AsyncTaskStatus.Error,
      });

      if (prechargeResult) {
        try {
          await chargeAfterGenerate({
            isError: true,
            metadata: {
              asyncTaskId,
              generationBatchId: createdBatch.id,
              modelId: model,
              topicId: generationTopicId,
            },
            model,
            prechargeResult,
            provider,
            userId,
          });
        } catch (chargeError) {
          console.error('[video] chargeAfterGenerate failed:', chargeError);
        }
      }
    }

    log('Video creation process completed: %O', {
      batchId: createdBatch.id,
      generationId: createdGeneration.id,
    });

    return {
      data: {
        batch: createdBatch,
        generations: [createdGeneration],
      },
      success: true,
    };
  }),

  getVideoFreeQuota: authedProcedure
    .input(z.object({ model: z.string() }))
    .query(async ({ ctx, input }) => {
      return getVideoFreeQuota(ctx.userId, input.model);
    }),
});

export type VideoRouter = typeof videoRouter;
