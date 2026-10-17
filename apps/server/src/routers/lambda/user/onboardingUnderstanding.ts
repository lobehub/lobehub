import type {
  ConfirmOnboardingUnderstandingInput,
  ConfirmOnboardingUnderstandingResult,
  CreateOnboardingTasksInput,
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

import {
  onboardingProgressEventId,
  projectOnboardingGenerationProgress,
  subscribeToOnboardingGenerationProgress,
} from '@/server/services/onboardingProgress';
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

export const onboardingUnderstandingProcedures = {
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
      if (
        initial.progress.phase === 'completed' ||
        initial.progress.phase === 'failed' ||
        initial.progress.phase === 'partial'
      ) {
        return;
      }

      const subscription = await subscribeToOnboardingGenerationProgress(input.topicId);
      if (subscription) {
        try {
          while (!signal?.aborted) {
            const notification = await subscription.next(signal);
            if (!notification) return;

            if (notification.eventId !== lastEventId) {
              lastEventId = notification.eventId;
              yield tracked(notification.eventId, notification.progress);
            }
            if (
              notification.progress.phase === 'completed' ||
              notification.progress.phase === 'failed' ||
              notification.progress.phase === 'partial'
            ) {
              return;
            }
          }
        } finally {
          await subscription.unsubscribe();
        }
        return;
      }

      let recoveryDelay = INITIAL_PROGRESS_RECOVERY_DELAY;
      while (!signal?.aborted) {
        await waitForProgressRecovery(recoveryDelay, signal);
        if (signal?.aborted) return;

        const { eventId, progress } = await readPersistedProgress();
        if (eventId !== lastEventId) {
          lastEventId = eventId;
          yield tracked(eventId, progress);
        }

        if (
          progress.phase === 'completed' ||
          progress.phase === 'failed' ||
          progress.phase === 'partial'
        ) {
          return;
        }
        recoveryDelay = Math.min(recoveryDelay * 2, MAX_PROGRESS_RECOVERY_DELAY);
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
};
