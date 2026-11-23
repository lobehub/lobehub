import type {
  ConfirmOnboardingUnderstandingInput,
  ConfirmOnboardingUnderstandingResult,
  CreateOnboardingTasksInput,
  OnboardingGenerationProgressEvent,
  OnboardingTaskRecommendationPollingResult,
  OnboardingTaskRecommendationTopicInput,
  OnboardingUnderstandingPollingResult,
  OnboardingUnderstandingTopicInput,
  RetryOnboardingUnderstandingProviderInput,
  ReviseOnboardingUnderstandingInput,
  StartOnboardingUnderstandingInput,
} from '@lobechat/types';
import { MAX_COLLECTION_COUNT, MAX_UNDERSTANDING_FEEDBACK_LENGTH } from '@lobechat/types';
import { tracked } from '@trpc/server';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import {
  onboardingProgressEventId,
  projectOnboardingGenerationProgress,
  subscribeToOnboardingGenerationProgress,
} from '@/server/services/onboardingProgress';
import {
  createOnboardingProgressStallGuard,
  ONBOARDING_PROGRESS_RECONCILE_INTERVAL_MS,
} from '@/server/services/onboardingProgress/stallGuard';
import { TaskRecommendationNotFoundError } from '@/server/services/taskRecommendation/service';
import { understandingProviders } from '@/server/services/understanding/providers';

import {
  onboardingGenerationProgressProcedure,
  taskRecommendationServiceProcedure,
  understandingServiceProcedure,
} from './procedures';

const understandingIdSchema = z.string().trim().min(1).max(512);

const onboardingUnderstandingTopicInputSchema = z
  .object({ topicId: understandingIdSchema })
  .strict() satisfies z.ZodType<OnboardingUnderstandingTopicInput>;

const startOnboardingUnderstandingInputSchema = z
  .object({
    providerIds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[\w-]+$/),
      )
      .max(16)
      .optional(),
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<StartOnboardingUnderstandingInput>;

const retryOnboardingUnderstandingSourceInputSchema = z
  .object({
    providerId: understandingIdSchema,
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<RetryOnboardingUnderstandingProviderInput>;

const confirmOnboardingUnderstandingInputSchema = z
  .object({
    resultId: understandingIdSchema,
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<ConfirmOnboardingUnderstandingInput>;

const reviseOnboardingUnderstandingInputSchema = z
  .object({
    expectedFeedbackRevision: z.number().int().nonnegative().max(MAX_COLLECTION_COUNT).optional(),
    feedback: z.string().trim().min(1).max(MAX_UNDERSTANDING_FEEDBACK_LENGTH).optional(),
    providerIds: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[\w-]+$/),
      )
      .max(16),
    responseLanguage: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})*$/i),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<ReviseOnboardingUnderstandingInput>;

const onboardingTaskRecommendationTopicInputSchema = z
  .object({ topicId: understandingIdSchema })
  .strict() satisfies z.ZodType<OnboardingTaskRecommendationTopicInput>;

const onboardingGenerationProgressInputSchema = z
  .object({
    // tRPC injects this tracked cursor into reconnection inputs. It is intentionally not trusted
    // as application state; polling remains the durable source of truth.
    lastEventId: z.string().trim().min(1).max(4096).optional(),
    topicId: understandingIdSchema,
  })
  .strict();

const createOnboardingTasksInputSchema = z
  .object({
    recommendationIds: z.array(z.string().trim().min(1).max(128)).max(48),
    sessionId: understandingIdSchema,
    topicId: understandingIdSchema,
  })
  .strict() satisfies z.ZodType<CreateOnboardingTasksInput>;

const INITIAL_PROGRESS_RECOVERY_DELAY = 3_000;

const MAX_PROGRESS_RECOVERY_DELAY = 30_000;

const waitForProgressRecovery = (delay: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * A session with no selected source has nothing scheduled, so no workflow will ever publish
 * progress for it. Keeping its stream open only ends in the Vercel 300s timeout followed by an
 * EventSource reconnect, repeating for as long as the onboarding page stays open. The client opens
 * a fresh stream after it adds sources through `revise`, so ending the idle stream loses nothing.
 */
const isIdleOnboardingGenerationProgress = (progress: OnboardingGenerationProgressEvent) =>
  progress.phase === 'collecting-sources' && progress.steps.collectSources === 'pending';

const shouldEndOnboardingProgressStream = (progress: OnboardingGenerationProgressEvent) =>
  progress.phase === 'completed' ||
  progress.phase === 'failed' ||
  progress.phase === 'partial' ||
  isIdleOnboardingGenerationProgress(progress);

type OnboardingProgressSubscription = NonNullable<
  Awaited<ReturnType<typeof subscribeToOnboardingGenerationProgress>>
>;

/**
 * Waits up to `delay` for a Redis notification, or just sleeps when Redis is unavailable.
 *
 * Returns:
 * - The notification, or `undefined` when the wait ended without one and the caller should read
 *   persisted state. A message arriving after the timeout stays queued for the next wait.
 */
const waitForProgressChange = async (
  subscription: OnboardingProgressSubscription | undefined,
  delay: number,
  signal: AbortSignal | undefined,
) => {
  if (!subscription) {
    await waitForProgressRecovery(delay, signal);
    return undefined;
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), delay);
  try {
    return await subscription.next(
      signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
    );
  } finally {
    clearTimeout(timer);
  }
};

export const onboardingUnderstandingRouter = router({
  confirmOnboardingUnderstanding: understandingServiceProcedure
    .input(confirmOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { personaVersion } = await ctx.understandingService.confirm(input);

      return {
        confirmed: true,
        personaVersion,
        resultId: input.resultId,
        sessionId: input.sessionId,
      } satisfies ConfirmOnboardingUnderstandingResult;
    }),
  createOnboardingTasks: taskRecommendationServiceProcedure
    .input(createOnboardingTasksInputSchema)
    .mutation(async ({ ctx, input }): Promise<Record<string, string>> => {
      return ctx.taskRecommendationService.createTasks(input);
    }),
  getOnboardingUnderstanding: understandingServiceProcedure
    .input(onboardingUnderstandingTopicInputSchema)
    .query(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.get(input.topicId);
    }),
  getOnboardingTaskRecommendations: taskRecommendationServiceProcedure
    .input(onboardingTaskRecommendationTopicInputSchema)
    .query(async ({ ctx, input }): Promise<OnboardingTaskRecommendationPollingResult> => {
      return ctx.taskRecommendationService.get(input.topicId);
    }),
  watchOnboardingGenerationProgress: onboardingGenerationProgressProcedure
    .input(onboardingGenerationProgressInputSchema)
    .subscription(async function* ({ ctx, input, signal }) {
      let lastEventId = input.lastEventId;
      const readPersistedProgress = async () => {
        const understanding = await ctx.understandingService.get(input.topicId);
        const taskRecommendations = await ctx.taskRecommendationService
          .get(input.topicId)
          .catch((error: unknown) => {
            if (error instanceof TaskRecommendationNotFoundError) return undefined;
            throw error;
          });
        const eventId = onboardingProgressEventId(understanding, taskRecommendations);
        const progress = projectOnboardingGenerationProgress(understanding, taskRecommendations);
        return { eventId, progress };
      };

      const initial = await readPersistedProgress();
      if (initial.eventId !== lastEventId) {
        lastEventId = initial.eventId;
        yield tracked(initial.eventId, initial.progress);
      }
      if (shouldEndOnboardingProgressStream(initial.progress)) return;

      const guard = createOnboardingProgressStallGuard(Date.now());
      const subscription = await subscribeToOnboardingGenerationProgress(input.topicId);
      let current = initial;
      // A write landing between the initial read and the subscribe publishes to nobody, so a
      // Redis-backed stream reconciles against the database as soon as it is listening.
      let readDelay = subscription ? 0 : INITIAL_PROGRESS_RECOVERY_DELAY;
      try {
        while (!signal?.aborted) {
          const delay = Math.min(readDelay, guard.remainingMs(current.progress.phase, Date.now()));
          const notification = await waitForProgressChange(subscription, delay, signal);
          if (signal?.aborted) return;

          // With Redis, a failed read is not fatal: notifications still flow and the guard still
          // bounds the stream. Without Redis the read is the only signal, so its error surfaces.
          const next =
            notification ??
            (subscription
              ? await readPersistedProgress().catch((error: unknown) => {
                  console.error('[onboardingProgress] Failed to reconcile progress', error);
                  return undefined;
                })
              : await readPersistedProgress());
          if (next) current = next;

          if (current.eventId !== lastEventId) {
            lastEventId = current.eventId;
            guard.recordProgress(Date.now());
            yield tracked(current.eventId, current.progress);
          }
          if (shouldEndOnboardingProgressStream(current.progress)) return;

          const stalledReason = guard.expiredReason(current.progress.phase, Date.now());
          if (stalledReason) {
            console.warn('[onboardingProgress] Ending progress stream before a terminal state', {
              phase: current.progress.phase,
              reason: stalledReason,
              sessionId: current.progress.sessionId,
            });
            const stalled: OnboardingGenerationProgressEvent = {
              ...current.progress,
              phase: 'stalled',
              stalledReason,
            };
            yield tracked(`${current.eventId}|stalled`, stalled);
            return;
          }

          if (!notification) {
            readDelay = subscription
              ? ONBOARDING_PROGRESS_RECONCILE_INTERVAL_MS
              : Math.min(readDelay * 2, MAX_PROGRESS_RECOVERY_DELAY);
          }
        }
      } finally {
        await subscription?.unsubscribe();
      }
    }),
  getSupportedUnderstandingProviders: understandingServiceProcedure.query(
    async ({
      ctx,
    }): Promise<{
      connectionSources: Record<string, 'composio' | 'lobehub'>;
      providerIds: string[];
      sourceProviderIds: string[];
    }> => {
      return {
        connectionSources: Object.fromEntries(
          understandingProviders.map((provider) => [provider.id, provider.connectionSource]),
        ),
        providerIds: understandingProviders.map((provider) => provider.id),
        sourceProviderIds: await ctx.understandingService.listSourceProviderIds(),
      };
    },
  ),
  reviseOnboardingUnderstanding: understandingServiceProcedure
    .input(reviseOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.revise(input);
    }),
  retryOnboardingUnderstandingSource: understandingServiceProcedure
    .input(retryOnboardingUnderstandingSourceInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return ctx.understandingService.retry(input);
    }),
  startOnboardingUnderstanding: understandingServiceProcedure
    .input(startOnboardingUnderstandingInputSchema)
    .mutation(async ({ ctx, input }): Promise<OnboardingUnderstandingPollingResult> => {
      return input.providerIds
        ? ctx.understandingService.start(input.topicId, input.responseLanguage, input.providerIds)
        : ctx.understandingService.start(input.topicId, input.responseLanguage);
    }),
});
