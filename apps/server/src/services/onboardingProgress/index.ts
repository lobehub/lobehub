import type {
  OnboardingGenerationProgressEvent,
  OnboardingTaskRecommendationPollingResult,
  OnboardingUnderstandingPollingResult,
} from '@lobechat/types';

import { getServerDB } from '@/database/server';
import { getRedisConfig } from '@/envs/redis';
import { isRedisEnabled } from '@/libs/redis';
import {
  createTaskRecommendationService,
  TaskRecommendationNotFoundError,
} from '@/server/services/taskRecommendation/service';
import { createUnderstandingService } from '@/server/services/understanding/service';

const PROGRESS_CHANNEL_PREFIX = 'onboarding-generation-progress';

interface ProgressEnvelope {
  eventId: string;
  progress: OnboardingGenerationProgressEvent;
}

interface ProgressSubscription {
  next: (signal?: AbortSignal) => Promise<ProgressEnvelope | undefined>;
  unsubscribe: () => Promise<void>;
}

const toProgressStatus = (
  status: 'completed' | 'failed' | 'partial' | 'pending' | 'processing' | 'running' | undefined,
): OnboardingGenerationProgressEvent['steps']['collectSources'] => {
  if (status === 'processing') return 'running';
  if (status === 'partial') return 'completed';
  return status ?? 'pending';
};

/**
 * Projects persisted onboarding workflow state into a content-free progress event.
 *
 * The session-level processing state covers the durable scheduling window after the
 * final source completes and before a downstream workflow has written its own state.
 */
export const projectOnboardingGenerationProgress = (
  understanding: OnboardingUnderstandingPollingResult,
  taskRecommendations: OnboardingTaskRecommendationPollingResult | undefined,
): OnboardingGenerationProgressEvent => {
  const sourceStatuses = Object.values(understanding.sources).map((source) => source.status);
  const collectSources: OnboardingGenerationProgressEvent['steps']['collectSources'] =
    sourceStatuses.some((status) => status === 'pending' || status === 'running')
      ? 'running'
      : sourceStatuses.length > 0 && sourceStatuses.every((status) => status === 'failed')
        ? 'failed'
        : sourceStatuses.length > 0
          ? 'completed'
          : 'pending';
  const understandingStatus = toProgressStatus(understanding.writing?.status);
  const detailedPersona = toProgressStatus(understanding.writing?.detailed?.status);
  const taskRecommendationsStatus = toProgressStatus(taskRecommendations?.status);
  const steps = {
    collectSources,
    detailedPersona,
    taskRecommendations: taskRecommendationsStatus,
    understanding: understandingStatus,
  };

  if (understanding.status === 'failed') {
    return { phase: 'failed', sessionId: understanding.id, steps };
  }
  if (understanding.status === 'partial') {
    return { phase: 'partial', sessionId: understanding.id, steps };
  }
  if (taskRecommendations?.status === 'failed' || taskRecommendations?.status === 'partial') {
    return { phase: 'partial', sessionId: understanding.id, steps };
  }
  if (collectSources === 'pending' || collectSources === 'running') {
    return { phase: 'collecting-sources', sessionId: understanding.id, steps };
  }
  if (understandingStatus === 'running') {
    return { phase: 'generating-understanding', sessionId: understanding.id, steps };
  }
  if (detailedPersona === 'running') {
    return { phase: 'generating-detailed-persona', sessionId: understanding.id, steps };
  }
  if (taskRecommendationsStatus === 'running') {
    return { phase: 'recommending-tasks', sessionId: understanding.id, steps };
  }
  if (understanding.status === 'processing') {
    return { phase: 'generating-understanding', sessionId: understanding.id, steps };
  }
  return { phase: 'completed', sessionId: understanding.id, steps };
};

/** Builds a stable opaque ID from persisted state for SSE reconnection deduplication. */
export const onboardingProgressEventId = (
  understanding: OnboardingUnderstandingPollingResult,
  taskRecommendations: OnboardingTaskRecommendationPollingResult | undefined,
) =>
  [
    understanding.id,
    understanding.generationRevision ?? 0,
    ...Object.entries(understanding.sources)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([providerId, source]) =>
        [providerId, source.revision, source.status, source.completedAt ?? ''].join(':'),
      ),
    understanding.writing?.status ?? '',
    understanding.writing?.updatedAt ?? '',
    understanding.writing?.detailed?.status ?? '',
    understanding.writing?.detailed?.updatedAt ?? '',
    taskRecommendations?.status ?? '',
    taskRecommendations?.updatedAt ?? '',
  ].join('|');

const progressChannel = (prefix: string, topicId: string) =>
  `${prefix}:${PROGRESS_CHANNEL_PREFIX}:${topicId}`;

const isProgressEnvelope = (value: unknown): value is ProgressEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  return typeof envelope.eventId === 'string' && Boolean(envelope.progress);
};

const createRedisClient = async () => {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return;

  const Redis = (await import('ioredis')).default;
  return new Redis(config.url, {
    commandTimeout: 10_000,
    connectTimeout: 10_000,
    db: config.database,
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    password: config.password,
    tls: config.tls ? {} : undefined,
    username: config.username,
  });
};

/**
 * Publishes one durable progress snapshot after an onboarding workflow state transition.
 *
 * Redis delivery is intentionally best-effort: polling remains the recovery path when Redis is
 * disabled or a Pub/Sub message is missed.
 */
export const publishOnboardingGenerationProgress = async (userId: string, topicId: string) => {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return;

  let redis: Awaited<ReturnType<typeof createRedisClient>>;
  try {
    redis = await createRedisClient();
    if (!redis) return;
    await redis.connect();

    const db = await getServerDB();
    const [understandingService, taskRecommendationService] = await Promise.all([
      createUnderstandingService({ db, userId }),
      createTaskRecommendationService({ db, userId }),
    ]);
    const understanding = await understandingService.get(topicId);
    const taskRecommendations = await taskRecommendationService
      .get(topicId)
      .catch((error: unknown) => {
        if (error instanceof TaskRecommendationNotFoundError) return undefined;
        throw error;
      });
    const progress = projectOnboardingGenerationProgress(understanding, taskRecommendations);
    const eventId = onboardingProgressEventId(understanding, taskRecommendations);

    await redis.publish(
      progressChannel(config.prefix, topicId),
      JSON.stringify({ eventId, progress }),
    );
  } catch (error) {
    // NOTICE:
    // Progress notifications are an acceleration path and must never fail the durable workflow.
    // The client polls persisted state after missed Redis events or unavailable Redis.
    console.error('[onboardingProgress] Failed to publish workflow progress', error);
  } finally {
    if (redis) await redis.quit().catch(() => undefined);
  }
};

/**
 * Bridges a Redis Pub/Sub channel into an awaitable subscription for one authenticated topic.
 *
 * The returned subscription is undefined when Redis is intentionally unavailable; callers then
 * use the bounded polling recovery path rather than keeping a database polling loop per SSE client.
 */
export const subscribeToOnboardingGenerationProgress = async (
  topicId: string,
): Promise<ProgressSubscription | undefined> => {
  const config = getRedisConfig();
  if (!isRedisEnabled(config)) return;

  const redis = await createRedisClient();
  if (!redis) return;
  const channel = progressChannel(config.prefix, topicId);
  const queued: ProgressEnvelope[] = [];
  let resolveNext: ((value: ProgressEnvelope | undefined) => void) | undefined;

  const onMessage = (receivedChannel: string, message: string) => {
    if (receivedChannel !== channel) return;
    try {
      const parsed: unknown = JSON.parse(message);
      if (!isProgressEnvelope(parsed)) return;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = undefined;
        resolve(parsed);
      } else {
        queued.push(parsed);
      }
    } catch {
      // Redis channels are an internal boundary; ignore malformed best-effort notifications.
    }
  };

  try {
    await redis.connect();
    redis.on('message', onMessage);
    await redis.subscribe(channel);
  } catch (error) {
    await redis.quit().catch(() => undefined);
    console.error('[onboardingProgress] Failed to subscribe to workflow progress', error);
    return;
  }

  return {
    next: (signal) => {
      const pending = queued.shift();
      if (pending) return Promise.resolve(pending);
      if (signal?.aborted) return Promise.resolve(undefined);

      return new Promise((resolve) => {
        const onAbort = () => {
          signal?.removeEventListener('abort', onAbort);
          if (resolveNext === resolve) resolveNext = undefined;
          resolve(undefined);
        };
        resolveNext = (event) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(event);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    unsubscribe: async () => {
      resolveNext?.(undefined);
      resolveNext = undefined;
      redis.removeListener('message', onMessage);
      await redis.unsubscribe(channel).catch(() => undefined);
      await redis.quit().catch(() => undefined);
    },
  };
};
