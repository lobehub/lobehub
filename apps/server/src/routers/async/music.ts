import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import type {
  ModelRuntime,
  MusicPollingRoute,
  MusicTrack,
  PollMusicStatusResult,
} from '@lobechat/model-runtime';
import {
  AsyncTaskStatus,
  type MusicGenerationAsset,
  type MusicGenerationTaskMetadata,
  RequestTrigger,
  type SpendOrigin,
} from '@lobechat/types';
import debug from 'debug';
import pMap from 'p-map';
import { z } from 'zod';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { chargeAfterGenerate } from '@/business/server/music-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { appEnv } from '@/envs/app';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { createMusicTaskError } from '@/server/routers/lambda/music/error';
import { GenerationService } from '@/server/services/generation';
import { MusicGenerationService } from '@/server/services/generation/music';
import { buildMusicGenerationFilePayload } from '@/server/services/generation/musicFile';
import {
  musicParamsInputSchema,
  toRuntimeMusicParams,
} from '@/server/services/generation/musicParams';
import { FileSource } from '@/types/files';

const log = debug('lobe-music:async');

/** Delay between two status queries of an asynchronous provider task */
export const MUSIC_POLL_INTERVAL_MS = 5000;
/** Consecutive thrown status queries tolerated before the task is failed */
export const MUSIC_POLL_MAX_CONSECUTIVE_ERRORS = 5;

const createMusicInputSchema = z.object({
  asyncTaskCreatedAt: z.date(),
  generationBatchId: z.string(),
  generationTopicId: z.string(),
  model: z.string(),
  params: musicParamsInputSchema,
  prechargeResult: z.any().optional(),
  provider: z.string(),
  /** Origin of the submitting request, kept for the completion charge */
  spendOrigin: z.custom<SpendOrigin>().optional(),
  /** One entry per song, in the order the provider's tracks should fill them */
  tasks: z.array(z.object({ asyncTaskId: z.string(), generationId: z.string() })).min(1),
  webhookToken: z.string(),
  workspaceId: z.string().optional(),
});

/** Caps concurrent async-task writes per batch so a large batch cannot exhaust the DB pool. */
const TASK_UPDATE_CONCURRENCY = 5;

class MusicStageError extends Error {
  constructor(
    readonly stage: 'process' | 'submit',
    readonly original: unknown,
  ) {
    super(original instanceof Error ? original.message : String(original));
  }
}

/** How many songs of one batch are downloaded and stored at the same time */
const MUSIC_STORE_CONCURRENCY = 2;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timeoutId = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeoutId);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Poll an asynchronous provider task until it succeeds, fails or the signal aborts (the
 * async task timeout). A thrown poll request is retried: one flaky status query must not
 * fail a song that is still being generated, but a persistent error (revoked key, gateway
 * gone) fails the task after {@link MUSIC_POLL_MAX_CONSECUTIVE_ERRORS} attempts instead of
 * idling until the timeout.
 */
export const pollMusicUntilCompletion = async (
  modelRuntime: Pick<ModelRuntime, 'handlePollMusicStatus'>,
  {
    inferenceId,
    intervalMs = MUSIC_POLL_INTERVAL_MS,
    model,
    route,
    signal,
  }: {
    inferenceId: string;
    intervalMs?: number;
    model: string;
    route?: MusicPollingRoute;
    signal: AbortSignal;
  },
): Promise<MusicTrack[]> => {
  let consecutiveErrors = 0;
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    let result: PollMusicStatusResult | undefined;
    let threw = false;
    try {
      result = await modelRuntime.handlePollMusicStatus(inferenceId, model, route, { signal });
      consecutiveErrors = 0;
    } catch (error) {
      threw = true;
      consecutiveErrors += 1;
      if (consecutiveErrors >= MUSIC_POLL_MAX_CONSECUTIVE_ERRORS) throw error;
      log('Poll attempt %d for %s threw, retrying: %O', attempt, inferenceId, error);
    }

    if (!threw && !result) throw new Error('This provider cannot poll music tasks');
    if (result?.status === 'success') return result.tracks;
    if (result?.status === 'failed')
      throw { error: { message: result.error }, errorType: result.errorType };

    await wait(intervalMs, signal);
  }
};

export const musicRouter = router({
  /**
   * Run one music batch: submit to the provider, poll if the provider is asynchronous, then
   * store every returned song and settle each generation's async task.
   */
  createMusic: asyncAuthedProcedure
    .input(createMusicInputSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        asyncTaskCreatedAt,
        generationBatchId,
        generationTopicId,
        model,
        params,
        prechargeResult,
        provider,
        spendOrigin,
        tasks,
        webhookToken,
        workspaceId,
      } = input;
      const asyncTaskModel = new AsyncTaskModel(ctx.serverDB, ctx.userId, workspaceId);
      const generationModel = new GenerationModel(ctx.serverDB, ctx.userId, workspaceId);
      const musicService = new MusicGenerationService(ctx.serverDB, ctx.userId, workspaceId);

      // Replaced by the mapped id once resolved; billing falls back to the requested id
      let resolvedModelId = model;

      /** Seconds of audio stored, for models priced per `second` */
      let storedSeconds = 0;

      const settleCharge = async (songs: number, latency?: number) => {
        if (!ENABLE_BUSINESS_FEATURES || !prechargeResult) return;
        const computePriceParams = {
          songs,
          ...(storedSeconds > 0 ? { duration: storedSeconds } : {}),
        };
        try {
          await chargeAfterGenerate({
            ...(songs > 0 ? { computePriceParams, latency } : { isError: true }),
            metadata: {
              ...spendOrigin,
              asyncTaskId: tasks[0].asyncTaskId,
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
            userId: ctx.userId,
            workspaceId,
          });
        } catch (chargeError) {
          console.error('[music-async] chargeAfterGenerate failed:', chargeError);
        }
      };

      // Songs already stored and tasks already settled survive a later failure of the batch
      let stored = 0;
      const settledTaskIds = new Set<string>();

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), ASYNC_TASK_TIMEOUT);
      const { signal } = abortController;

      try {
        ({ resolvedModelId } = await resolveBusinessModelMapping(provider, model));

        await pMap(
          tasks,
          ({ asyncTaskId }) =>
            asyncTaskModel.update(asyncTaskId, { status: AsyncTaskStatus.Processing }),
          { concurrency: TASK_UPDATE_CONCURRENCY },
        );

        const modelRuntime = await initModelRuntimeFromDB(
          ctx.serverDB,
          ctx.userId,
          provider,
          workspaceId,
        );

        const callbackBaseUrl = appEnv.WEBHOOK_PROXY_URL || appEnv.APP_URL;
        const callbackUrl = new URL(
          `${(callbackBaseUrl ?? '').replace(/\/+$/, '')}/api/webhooks/music/${provider}`,
        );
        callbackUrl.searchParams.set('token', webhookToken);

        // 1. Submit
        let submitted;
        try {
          submitted = await modelRuntime.createMusic(
            { model: resolvedModelId, params: toRuntimeMusicParams(params) },
            {
              callbackUrl: callbackUrl.toString(),
              metadata: { trigger: RequestTrigger.Music },
              signal,
            },
          );
        } catch (error) {
          throw new MusicStageError('submit', error);
        }
        if (!submitted)
          throw new MusicStageError(
            'submit',
            new Error(`Provider "${provider}" does not support music generation`),
          );

        // 2. Poll asynchronous providers
        let tracks: MusicTrack[];
        if (submitted.status === 'pending') {
          log('Music task %s is pending, polling', submitted.inferenceId);
          await pMap(
            tasks,
            ({ asyncTaskId }, index) => {
              const metadata: MusicGenerationTaskMetadata = {
                index,
                ...(prechargeResult ? { precharge: prechargeResult } : {}),
                ...(submitted.route ? { route: submitted.route } : {}),
                ...(spendOrigin ? { spendOrigin } : {}),
                webhookToken,
              };
              return asyncTaskModel.update(asyncTaskId, {
                inferenceId: submitted.inferenceId,
                metadata,
              });
            },
            { concurrency: TASK_UPDATE_CONCURRENCY },
          );

          try {
            tracks = await pollMusicUntilCompletion(modelRuntime, {
              inferenceId: submitted.inferenceId,
              model: resolvedModelId,
              route: submitted.route,
              signal,
            });
          } catch (error) {
            throw new MusicStageError('process', error);
          }
        } else {
          tracks = submitted.tracks;
          if (submitted.inferenceId)
            await pMap(
              tasks,
              ({ asyncTaskId }) =>
                asyncTaskModel.update(asyncTaskId, { inferenceId: submitted.inferenceId }),
              { concurrency: TASK_UPDATE_CONCURRENCY },
            );
        }

        log('Provider returned %d tracks for batch %s', tracks.length, generationBatchId);
        if (tracks.length > tasks.length)
          log('Ignoring %d extra tracks beyond the batch size', tracks.length - tasks.length);

        // 3. Store each song in its generation; one failed download fails only that song
        const batch = await ctx.serverDB.query.generationBatches.findFirst({
          where: (batches, { and, eq }) =>
            and(eq(batches.id, generationBatchId), eq(batches.userId, ctx.userId)),
        });

        const coverKeys: (string | undefined)[] = [];

        // Store songs two at a time: a batch finishing near the task deadline waits for fewer
        // sequential downloads, while each song is buffered in memory (up to 100 MB) only two
        // at a time.
        await pMap(
          tasks,
          async ({ asyncTaskId, generationId }, index) => {
            const track = tracks[index];
            const duration = Date.now() - asyncTaskCreatedAt.getTime();

            if (!track) {
              await asyncTaskModel.update(asyncTaskId, {
                error: createMusicTaskError(
                  new Error(`The provider returned ${tracks.length} of ${tasks.length} songs`),
                  'process',
                ),
                status: AsyncTaskStatus.Error,
              });
              // Only once the error is written; otherwise the batch failure path retries it
              settledTaskIds.add(asyncTaskId);
              return;
            }

            // Storing is not bound by the polling timeout: the provider already produced (and
            // billed) the song, and each download has its own timeout.
            try {
              const processResult = await musicService.processTrack(track);

              const asset: MusicGenerationAsset = {
                coverUrl: processResult.coverKey,
                duration: processResult.duration,
                mimeType: processResult.mimeType,
                ...(track.audioUrl ? { originalUrl: track.audioUrl } : {}),
                ...(track.id ? { providerTrackId: track.id } : {}),
                ...(track.tags ? { tags: track.tags } : {}),
                title: track.title || params.title || undefined,
                type: 'audio',
                url: processResult.audioKey,
              };

              await generationModel.createAssetAndFile(
                generationId,
                asset,
                buildMusicGenerationFilePayload({
                  generationId,
                  processResult,
                  prompt: batch?.prompt,
                  title: asset.title,
                }),
                FileSource.MusicGeneration,
              );

              coverKeys[index] = processResult.coverKey;
              stored += 1;
              storedSeconds += processResult.duration ?? 0;
              settledTaskIds.add(asyncTaskId);
            } catch (error) {
              console.error(
                '[music-async] Failed to store track %d of %s:',
                index,
                generationBatchId,
                error,
              );
              await asyncTaskModel.update(asyncTaskId, {
                error: createMusicTaskError(error, 'process'),
                status: AsyncTaskStatus.Error,
              });
              settledTaskIds.add(asyncTaskId);
              return;
            }

            // The song is stored: a failed status write must not turn it into an error card,
            // so retry it once instead of falling into the storage failure path above.
            const success = { duration, status: AsyncTaskStatus.Success };
            try {
              await asyncTaskModel.update(asyncTaskId, success);
            } catch (error) {
              console.error('[music-async] Retrying the success status of %s:', asyncTaskId, error);
              try {
                await asyncTaskModel.update(asyncTaskId, success);
              } catch (retryError) {
                console.error(
                  '[music-async] Failed to mark stored song %s as succeeded:',
                  asyncTaskId,
                  retryError,
                );
              }
            }
          },
          { concurrency: MUSIC_STORE_CONCURRENCY },
        );

        // The first stored song's cover, as in batch order
        const topicCoverKey = coverKeys.find(Boolean);
        if (topicCoverKey) {
          // The cover is decoration; its failure must not touch the stored songs
          try {
            await new GenerationService(ctx.serverDB, ctx.userId, workspaceId).ensureTopicCover(
              generationTopicId,
              topicCoverKey,
            );
          } catch (error) {
            console.error('[music-async] Failed to set the topic cover:', error);
          }
        }

        await settleCharge(stored, Date.now() - asyncTaskCreatedAt.getTime());

        log('Music batch %s finished: %d/%d songs stored', generationBatchId, stored, tasks.length);
        return { stored, success: stored > 0 };
      } catch (error) {
        const stage = error instanceof MusicStageError ? error.stage : 'process';
        const original = error instanceof MusicStageError ? error.original : error;
        console.error('[music-async] Music batch %s failed:', generationBatchId, original);

        const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
          error: original,
          provider,
          trigger: RequestTrigger.Music,
          userId: ctx.userId,
        });
        const taskError = createMusicTaskError(original, stage, providerContentPolicyMessage);

        // Best effort: one failed status write must not stop the others or the settlement below
        await pMap(
          tasks.filter(({ asyncTaskId }) => !settledTaskIds.has(asyncTaskId)),
          async ({ asyncTaskId }) => {
            try {
              await asyncTaskModel.update(asyncTaskId, {
                error: taskError,
                status: AsyncTaskStatus.Error,
              });
            } catch (updateError) {
              console.error(
                '[music-async] Failed to mark task %s as errored:',
                asyncTaskId,
                updateError,
              );
            }
          },
          { concurrency: TASK_UPDATE_CONCURRENCY },
        );
        // Charge the songs delivered before the failure; refund when there were none
        await settleCharge(stored);

        return { message: taskError.body.detail, stored, success: stored > 0 };
      } finally {
        clearTimeout(timeoutId);
      }
    }),
});
