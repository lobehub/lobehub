import { randomBytes } from 'node:crypto';

import { resolveBusinessModelMapping } from '@lobechat/business-model-runtime';
import { type MusicGenerationTaskMetadata } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { chargeAfterGenerate } from '@/business/server/music-generation/chargeAfterGenerate';
import { chargeBeforeGenerate } from '@/business/server/music-generation/chargeBeforeGenerate';
import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationTopicModel } from '@/database/models/generationTopic';
import {
  asyncTasks,
  generationBatches,
  type GenerationItem,
  generations,
  type NewGeneration,
  type NewGenerationBatch,
} from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createAsyncCaller } from '@/server/routers/async/caller';
import { FileService } from '@/server/services/file';
import { resolveMusicModelCard } from '@/server/services/generation/musicModel';
import {
  musicParamsInputSchema,
  pickDeclaredMusicParams,
  validateMusicParams,
} from '@/server/services/generation/musicParams';
import { AsyncTaskStatus, AsyncTaskType } from '@/types/asyncTask';

import { createMusicTaskError } from './error';

const log = debug('lobe-music:lambda');

const musicProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
      generationTopicModel: new GenerationTopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

const musicCreateProcedure = musicProcedure.use(withScopedPermission('file:upload'));

const createMusicInputSchema = z.object({
  generationTopicId: z.string().min(1),
  model: z.string().min(1),
  params: musicParamsInputSchema,
  provider: z.string().min(1),
});
export type CreateMusicServicePayload = z.infer<typeof createMusicInputSchema>;

export const musicRouter = router({
  /**
   * Submit a text-to-music generation. Creates one batch with one generation (and one async
   * task) per song the model returns, then hands the provider call to the async router, which
   * polls asynchronous providers and stores every song in file storage.
   */
  createMusic: musicCreateProcedure
    .input(createMusicInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { userId, serverDB, asyncTaskModel, fileService, generationTopicModel } = ctx;
      const wsId = ctx.workspaceId ?? undefined;
      const { generationTopicId, model, provider } = input;

      const { resolvedModelId } = await resolveBusinessModelMapping(provider, model);

      const card = await resolveMusicModelCard({
        db: serverDB,
        model: resolvedModelId,
        provider,
        userId,
        workspaceId: wsId,
      });
      if (!card || card.type !== 'text2music') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: card
            ? `Model "${model}" is a ${card.type} model, not a music generation (text2music) model`
            : `Model "${model}" is not available for provider "${provider}"`,
        });
      }

      const paramErrors = validateMusicParams(input.params, card.parameters);
      if (paramErrors.length > 0) {
        throw new TRPCError({
          cause: { errors: paramErrors },
          code: 'BAD_REQUEST',
          message: `Invalid music params: ${paramErrors.join('; ')}`,
        });
      }
      const params = pickDeclaredMusicParams(input.params, card.parameters);

      const generationTopic = await generationTopicModel.findById(generationTopicId);
      if (!generationTopic) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid generation topic' });
      }
      if (generationTopic.type !== 'music') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Music can only be generated in a music generation topic',
        });
      }

      log('Starting music creation: %O', { model, provider, songs: card.outputsPerRequest });

      // Store our own uploads as keys, as video does for reference images; the provider still
      // receives the full URL. A pasted third-party URL is kept as is: rewriting it to a key
      // would later resolve it against our storage domain.
      const getOwnStorageKey = async (url: string) => {
        const key = await fileService.getKeyFromFullUrl(url);
        if (!key) return null;
        if (new URL(url).pathname.startsWith('/f/')) return key;

        const storedUrl = await fileService.getFullFileUrl(key);
        return storedUrl && new URL(storedUrl).origin === new URL(url).origin ? key : null;
      };
      let configForDatabase: Record<string, unknown> = { ...params };
      let generationParams = params;
      if (params.referenceAudioUrl) {
        try {
          const key = await getOwnStorageKey(params.referenceAudioUrl);
          if (key) {
            configForDatabase = { ...configForDatabase, referenceAudioUrl: key };
            // A dev proxy URL (localhost) is unreachable for the provider; give it the S3 URL
            if (process.env.NODE_ENV === 'development') {
              const s3Url = await fileService.getFullFileUrl(key);
              if (s3Url) generationParams = { ...params, referenceAudioUrl: s3Url };
            }
          }
        } catch (error) {
          console.error('[music] Failed to convert referenceAudioUrl to a key: %O', error);
        }
      }

      const songCount = card.outputsPerRequest;

      const { errorBatch, prechargeResult } = await chargeBeforeGenerate({
        generationTopicId,
        model,
        params,
        provider,
        songCount,
        spendOrigin: ctx.spendOrigin,
        userId,
        workspaceId: wsId,
      });
      if (errorBatch) return errorBatch;

      // One-time token the provider callback URL carries (some providers require a callback)
      const webhookToken = randomBytes(32).toString('hex');

      const { batch, tasks } = await serverDB.transaction(async (tx) => {
        const newBatch: NewGenerationBatch = {
          config: configForDatabase,
          generationTopicId,
          model,
          prompt: params.prompt || params.style || params.title || '',
          provider,
          userId,
          workspaceId: wsId,
        };
        const [batch] = await tx.insert(generationBatches).values(newBatch).returning();

        const newGenerations: NewGeneration[] = Array.from({ length: songCount }, () => ({
          generationBatchId: batch.id,
          userId,
          workspaceId: wsId,
        }));
        const createdGenerations = await tx.insert(generations).values(newGenerations).returning();

        // One transaction runs on one connection, so insert the tasks one after another
        const tasks: {
          asyncTaskCreatedAt: Date;
          asyncTaskId: string;
          generation: GenerationItem;
        }[] = [];
        for (const [index, generation] of createdGenerations.entries()) {
          const metadata: MusicGenerationTaskMetadata = {
            index,
            ...(prechargeResult ? { precharge: prechargeResult } : {}),
            ...(ctx.spendOrigin ? { spendOrigin: ctx.spendOrigin } : {}),
            webhookToken,
          };
          const [asyncTask] = await tx
            .insert(asyncTasks)
            .values({
              metadata,
              status: AsyncTaskStatus.Pending,
              type: AsyncTaskType.MusicGeneration,
              userId,
              workspaceId: wsId,
            })
            .returning();

          await tx
            .update(generations)
            .set({ asyncTaskId: asyncTask.id })
            .where(and(eq(generations.id, generation.id), eq(generations.userId, userId)));

          tasks.push({
            asyncTaskCreatedAt: asyncTask.createdAt,
            asyncTaskId: asyncTask.id,
            generation,
          });
        }

        return { batch, tasks };
      });

      log('Created batch %s with %d generations', batch.id, tasks.length);

      try {
        const asyncCaller = await createAsyncCaller({ userId });

        // Fire-and-forget: the async router owns task status and billing from here on. A failed
        // HTTP response (e.g. a proxy timing out a long generation) does not mean the task
        // failed, so only log it.
        asyncCaller.music
          .createMusic({
            asyncTaskCreatedAt: tasks[0].asyncTaskCreatedAt,
            generationBatchId: batch.id,
            generationTopicId,
            model,
            params: generationParams,
            prechargeResult: prechargeResult ?? undefined,
            provider,
            spendOrigin: ctx.spendOrigin,
            tasks: tasks.map(({ asyncTaskId, generation }) => ({
              asyncTaskId,
              generationId: generation.id,
            })),
            webhookToken,
            workspaceId: wsId,
          })
          .catch((error: unknown) => {
            console.error('[music] Async music request for batch %s failed: %O', batch.id, error);
          });
      } catch (error) {
        console.error('[music] Failed to start the async music task:', error);

        // Best effort: one failed status write must not stop the others or the refund below
        await pMap(
          tasks,
          async ({ asyncTaskId }) => {
            try {
              await asyncTaskModel.update(asyncTaskId, {
                error: createMusicTaskError(error, 'submit'),
                status: AsyncTaskStatus.Error,
              });
            } catch (updateError) {
              console.error('[music] Failed to mark task %s as errored:', asyncTaskId, updateError);
            }
          },
          { concurrency: 5 },
        );

        // The async router never ran, so refund the pre-charge here
        if (prechargeResult) {
          try {
            await chargeAfterGenerate({
              isError: true,
              metadata: {
                asyncTaskId: tasks[0].asyncTaskId,
                generationBatchId: batch.id,
                modelId: resolvedModelId,
                topicId: generationTopicId,
              },
              model: resolvedModelId,
              prechargeResult,
              provider,
              userId,
              workspaceId: wsId,
            });
          } catch (chargeError) {
            console.error('[music] chargeAfterGenerate failed:', chargeError);
          }
        }
      }

      return {
        data: {
          batch,
          generations: tasks.map(({ asyncTaskId, generation }) => ({ ...generation, asyncTaskId })),
        },
        success: true as const,
      };
    }),
});

export type MusicRouter = typeof musicRouter;
