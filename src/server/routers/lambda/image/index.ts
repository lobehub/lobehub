import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { chargeBeforeGenerate } from '@/business/server/image-generation/chargeBeforeGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { type NewGeneration, type NewGenerationBatch } from '@/database/schemas';
import { asyncTasks, generationBatches, generations } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { keyVaults, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAsyncCaller } from '@/server/routers/async/caller';
import { FileService } from '@/server/services/file';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';
import { generateUniqueSeeds } from '@/utils/number';

import { validateNoUrlsInConfig } from './utils';

const log = debug('lobe-image:lambda');

const imageProcedure = authedProcedure
  .use(keyVaults)
  .use(serverDatabase)
  .use(async (opts) => {
    const { ctx } = opts;

    const { apiKey } = ctx.jwtPayload;
    if (apiKey) {
      log('API key found in jwtPayload: %s', apiKey);
    } else {
      log('No API key found in jwtPayload');
    }

    return opts.next({
      ctx: {
        asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
        fileService: new FileService(ctx.serverDB, ctx.userId),
      },
    });
  });

const createImageInputSchema = z.object({
  generationTopicId: z.string(),
  imageNum: z.number(),
  model: z.string(),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string(),
      seed: z.number().nullable().optional(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string(),
});
export type CreateImageServicePayload = z.infer<typeof createImageInputSchema>;

export const imageRouter = router({
  createImage: imageProcedure.input(createImageInputSchema).mutation(async ({ input, ctx }) => {
    const { userId, serverDB, asyncTaskModel, fileService } = ctx;
    const { generationTopicId, provider, model, imageNum, params } = input;

    log('Starting image creation process, input: %O', input);

    // Normalize reference image addresses, store S3 keys uniformly (avoid storing expiring presigned URLs in database)
    let configForDatabase = { ...params };
    // 1) Process multiple images in imageUrls
    if (Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
      log('Converting imageUrls to S3 keys for database storage: %O', params.imageUrls);
      try {
        const imageKeysWithNull = await Promise.all(
          params.imageUrls.map(async (url) => {
            const key = await fileService.getKeyFromFullUrl(url);
            if (key) {
              log('Converted URL %s to key %s', url, key);
            } else {
              log('Failed to extract key from URL: %s', url);
            }
            return key;
          }),
        );
        const imageKeys = imageKeysWithNull.filter((key): key is string => key !== null);

        configForDatabase = {
          ...configForDatabase,
          imageUrls: imageKeys,
        };
        log('Successfully converted imageUrls to keys for database: %O', imageKeys);
      } catch (error) {
        console.error('Error converting imageUrls to keys: %O', error);
        console.error('Keeping original imageUrls due to conversion error');
      }
    }
    // 2) Process single image in imageUrl
    if (typeof params.imageUrl === 'string' && params.imageUrl) {
      try {
        const key = await fileService.getKeyFromFullUrl(params.imageUrl);
        if (key) {
          log('Converted single imageUrl to key: %s -> %s', params.imageUrl, key);
          configForDatabase = { ...configForDatabase, imageUrl: key };
        } else {
          log('Failed to extract key from single imageUrl: %s', params.imageUrl);
        }
      } catch (error) {
        console.error('Error converting imageUrl to key: %O', error);
        // Keep original value if conversion fails
      }
    }

    // In development, convert localhost proxy URLs to S3 URLs for async task access
    let generationParams = params;
    if (process.env.NODE_ENV === 'development') {
      const updates: Record<string, unknown> = {};

      // Handle single imageUrl: localhost/f/{id} -> S3 URL
      if (typeof params.imageUrl === 'string' && params.imageUrl) {
        const s3Url = await fileService.getFullFileUrl(configForDatabase.imageUrl as string);
        if (s3Url) {
          log('Dev: converted proxy URL to S3 URL: %s -> %s', params.imageUrl, s3Url);
          updates.imageUrl = s3Url;
        }
      }

      // Handle multiple imageUrls
      if (Array.isArray(params.imageUrls) && params.imageUrls.length > 0) {
        const s3Urls = await Promise.all(
          (configForDatabase.imageUrls as string[]).map((key) => fileService.getFullFileUrl(key)),
        );
        log('Dev: converted proxy URLs to S3 URLs: %O', s3Urls);
        updates.imageUrls = s3Urls;
      }

      if (Object.keys(updates).length > 0) {
        generationParams = { ...params, ...updates };
      }
    }

    // Defensive check: ensure no full URLs enter the database
    validateNoUrlsInConfig(configForDatabase, 'configForDatabase');

    const chargeResult = await chargeBeforeGenerate({
      clientIp: ctx.clientIp,
      configForDatabase,
      generationParams,
      generationTopicId,
      imageNum,
      model,
      provider,
      userId,
    });
    if (chargeResult) {
      return chargeResult;
    }

    // Step 1: Atomically create all database records in a transaction
    const { batch: createdBatch, generationsWithTasks } = await serverDB.transaction(async (tx) => {
      log('Starting database transaction for image generation');

      // 1. Create generationBatch
      const newBatch: NewGenerationBatch = {
        config: configForDatabase,
        generationTopicId,
        height: params.height,
        model,
        prompt: params.prompt,
        provider,
        userId,
        width: params.width, // Use converted config for database storage
      };
      log('Creating generation batch: %O', newBatch);
      const [batch] = await tx.insert(generationBatches).values(newBatch).returning();
      log('Generation batch created successfully: %s', batch.id);

      // 2. Create generations
      const seeds =
        'seed' in params
          ? generateUniqueSeeds(imageNum)
          : Array.from({ length: imageNum }, () => null);
      const newGenerations: NewGeneration[] = Array.from({ length: imageNum }, (_, index) => {
        return {
          generationBatchId: batch.id,
          seed: seeds[index],
          userId,
        };
      });

      log('Creating %d generations for batch: %s', newGenerations.length, batch.id);
      const createdGenerations = await tx.insert(generations).values(newGenerations).returning();
      log(
        'Generations created successfully: %O',
        createdGenerations.map((g) => g.id),
      );

      // 3. Concurrently create asyncTask for each generation (within transaction)
      log('Creating async tasks for generations');
      const generationsWithTasks = await Promise.all(
        createdGenerations.map(async (generation) => {
          // Create asyncTask directly in transaction
          const [createdAsyncTask] = await tx
            .insert(asyncTasks)
            .values({
              status: AsyncTaskStatus.Pending,
              type: AsyncTaskType.ImageGeneration,
              userId,
            })
            .returning();

          const asyncTaskId = createdAsyncTask.id;
          log('Created async task %s for generation %s', asyncTaskId, generation.id);

          // Update generation's asyncTaskId
          await tx
            .update(generations)
            .set({ asyncTaskId })
            .where(and(eq(generations.id, generation.id), eq(generations.userId, userId)));

          return { asyncTaskId, generation };
        }),
      );
      log('All async tasks created in transaction');

      return {
        batch,
        generationsWithTasks,
      };
    });

    log('Database transaction completed successfully. Starting async task triggers directly.');

    // Step 2: Trigger background image generation tasks using after() API
    log('Starting async image generation tasks with after()');

    try {
      log('Creating unified async caller for userId: %s', userId);

      // Async router will read keyVaults from DB, no need to pass jwtPayload
      const asyncCaller = await createAsyncCaller({
        userId: ctx.userId,
      });

      log('Unified async caller created successfully for userId: %s', ctx.userId);
      log('Processing %d async image generation tasks', generationsWithTasks.length);

      // Fire-and-forget: trigger async tasks without awaiting
      // These calls go to the async router which handles them independently
      // Do NOT use after() here as it would keep the lambda alive unnecessarily
      generationsWithTasks.forEach(({ generation, asyncTaskId }) => {
        log('Starting background async task %s for generation %s', asyncTaskId, generation.id);

        asyncCaller.image.createImage({
          generationBatchId: createdBatch.id,
          generationId: generation.id,
          generationTopicId,
          model,
          params: generationParams,
          provider,
          taskId: asyncTaskId,
        });
      });

      log('All %d background async image generation tasks started', generationsWithTasks.length);
    } catch (e) {
      console.error('Failed to process async tasks:', e);
      console.error('Failed to process async tasks: %O', e);

      // If overall failure occurs, update all task statuses to failed
      try {
        await Promise.allSettled(
          generationsWithTasks.map(({ asyncTaskId }) =>
            asyncTaskModel.update(asyncTaskId, {
              error: new AsyncTaskError(
                AsyncTaskErrorType.ServerError,
                'start async task error: ' + (e instanceof Error ? e.message : 'Unknown error'),
              ),
              status: AsyncTaskStatus.Error,
            }),
          ),
        );
      } catch (batchUpdateError) {
        console.error('Failed to update batch task statuses:', batchUpdateError);
      }
    }

    const createdGenerations = generationsWithTasks.map((item) => item.generation);
    log('Image creation process completed successfully: %O', {
      batchId: createdBatch.id,
      generationCount: createdGenerations.length,
      generationIds: createdGenerations.map((g) => g.id),
    });

    return {
      data: {
        batch: createdBatch,
        generations: createdGenerations,
      },
      success: true,
    };
  }),
});

export type ImageRouter = typeof imageRouter;
