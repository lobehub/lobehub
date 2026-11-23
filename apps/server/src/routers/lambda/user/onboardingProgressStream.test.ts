// @vitest-environment node
import type { OnboardingGenerationProgressEvent } from '@lobechat/types';
import { isTrackedEnvelope } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as OnboardingProgressModule from '@/server/services/onboardingProgress';
import {
  ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS,
  ONBOARDING_PROGRESS_STREAM_BUDGET_MS,
} from '@/server/services/onboardingProgress/stallGuard';

import { userRouter } from '../user';

const mockUnderstandingService = vi.hoisted(() => ({ get: vi.fn() }));
const mockTaskRecommendationService = vi.hoisted(() => ({ get: vi.fn() }));
const mockSubscribe = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/database', () => {
  class StaleUnderstandingSessionError extends Error {}
  class StaleUnderstandingRevisionError extends Error {}
  class UnderstandingPreconditionError extends Error {}
  class UnderstandingResourceNotFoundError extends Error {}
  class UnderstandingSessionNotFoundError extends Error {}

  return {
    StaleUnderstandingRevisionError,
    StaleUnderstandingSessionError,
    UnderstandingPreconditionError,
    UnderstandingResourceNotFoundError,
    UnderstandingSessionNotFoundError,
  };
});
vi.mock('@/business/server/user', () => ({
  getReferralStatus: vi.fn(),
  getSubscriptionPlan: vi.fn(),
  onUserActivityForBusiness: vi.fn(),
}));
vi.mock('@/database/server', () => ({ serverDB: {} }));
vi.mock('@/database/models/message');
vi.mock('@/database/models/rbac');
vi.mock('@/database/models/session');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/server/modules/S3');
vi.mock('@/server/services/user');
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(async () => mockUnderstandingService),
}));
vi.mock('@/server/services/taskRecommendation/service', () => {
  class TaskRecommendationNotFoundError extends Error {}

  return {
    createTaskRecommendationService: vi.fn(async () => mockTaskRecommendationService),
    TaskRecommendationNotFoundError,
  };
});
vi.mock('@/server/workflows/onboardingUnderstanding', () => {
  class UnderstandingWorkflowUnavailableError extends Error {}

  return { UnderstandingWorkflowUnavailableError };
});
vi.mock('@/server/services/onboardingProgress', async (importOriginal) => ({
  ...(await importOriginal<typeof OnboardingProgressModule>()),
  subscribeToOnboardingGenerationProgress: mockSubscribe,
}));

const source = (status: 'completed' | 'running', revision = 1) => ({
  errors: [],
  failedCount: 0,
  revision,
  status,
  succeededCount: status === 'completed' ? 1 : 0,
});

const collectingSession = (revision = 1) => ({
  id: 'session-1',
  sources: { github: source('running', revision) },
  status: 'processing',
});

const writingSession = (updatedAt = '2026-11-23T00:00:00.000Z') => ({
  id: 'session-1',
  sources: { github: source('completed') },
  status: 'processing',
  writing: { status: 'running', updatedAt },
});

const completedSession = () => ({
  id: 'session-1',
  sources: { github: source('completed') },
  status: 'completed',
  writing: {
    resultMessageId: 'message-1',
    sourceFingerprint: 'github@1',
    status: 'completed',
    updatedAt: '2026-11-23T00:10:00.000Z',
  },
});

/** A controllable Redis subscription whose `next` honours abort like the real bridge. */
const createSubscription = () => {
  const queued: unknown[] = [];
  let deliver: ((value: unknown) => void) | undefined;

  return {
    next: vi.fn((signal?: AbortSignal) => {
      if (queued.length > 0) return Promise.resolve(queued.shift());
      return new Promise((resolve) => {
        deliver = resolve;
        signal?.addEventListener(
          'abort',
          () => {
            deliver = undefined;
            resolve(undefined);
          },
          { once: true },
        );
      });
    }),
    publish: (value: unknown) => {
      if (deliver) {
        const resolve = deliver;
        deliver = undefined;
        resolve(value);
      } else {
        queued.push(value);
      }
    },
    unsubscribe: vi.fn(async () => undefined),
  };
};

const watch = async () => {
  const stream = await userRouter
    .createCaller({ userId: 'user-1' } as never)
    .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
  const events: OnboardingGenerationProgressEvent[] = [];
  let ended = false;
  const consumed = (async () => {
    for await (const chunk of stream) {
      if (!isTrackedEnvelope(chunk)) throw new Error('Expected a tracked progress event');
      events.push(chunk[1] as OnboardingGenerationProgressEvent);
    }
    ended = true;
  })();

  return { consumed, events, hasEnded: () => ended };
};

describe('watchOnboardingGenerationProgress stall guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockUnderstandingService.get.mockReset();
    mockTaskRecommendationService.get.mockReset().mockResolvedValue(undefined);
    mockSubscribe.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ends a polling stream with a stalled event once its phase stops changing', async () => {
    mockUnderstandingService.get.mockResolvedValue(collectingSession());

    const { consumed, events, hasEnded } = await watch();
    const threshold = ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS['collecting-sources'];

    await vi.advanceTimersByTimeAsync(threshold - 1_000);
    expect(hasEnded()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await consumed;

    expect(events.at(-1)).toMatchObject({ phase: 'stalled', stalledReason: 'no-progress' });
  });

  it('ends a Redis stream with a stalled event when no notification arrives', async () => {
    const subscription = createSubscription();
    mockSubscribe.mockResolvedValue(subscription);
    mockUnderstandingService.get.mockResolvedValue(collectingSession());

    const { consumed, events } = await watch();
    await vi.advanceTimersByTimeAsync(
      ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS['collecting-sources'],
    );
    await consumed;

    expect(events.at(-1)).toMatchObject({ phase: 'stalled', stalledReason: 'no-progress' });
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('recovers a terminal state whose Redis message was lost', async () => {
    const subscription = createSubscription();
    mockSubscribe.mockResolvedValue(subscription);
    mockUnderstandingService.get.mockResolvedValue(writingSession());

    const { consumed, events, hasEnded } = await watch();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(hasEnded()).toBe(false);

    mockUnderstandingService.get.mockResolvedValue(completedSession());
    await vi.advanceTimersByTimeAsync(15_000);
    await consumed;

    expect(events.at(-1)?.phase).toBe('completed');
    expect(events.some(({ phase }) => phase === 'stalled')).toBe(false);
  });

  it('catches a write that lands between the initial read and the subscribe', async () => {
    const subscription = createSubscription();
    mockSubscribe.mockResolvedValue(subscription);
    mockUnderstandingService.get
      .mockResolvedValueOnce(writingSession())
      .mockResolvedValue(completedSession());

    const { consumed, events } = await watch();
    await vi.advanceTimersByTimeAsync(0);
    await consumed;

    expect(events.map(({ phase }) => phase)).toEqual(['generating-understanding', 'completed']);
  });

  it('delivers a terminal notification without waiting for reconciliation', async () => {
    const subscription = createSubscription();
    mockSubscribe.mockResolvedValue(subscription);
    mockUnderstandingService.get.mockResolvedValue(writingSession());

    const { consumed, events } = await watch();
    await vi.advanceTimersByTimeAsync(1_000);

    subscription.publish({
      eventId: 'terminal',
      progress: {
        phase: 'completed',
        sessionId: 'session-1',
        steps: {
          collectSources: 'completed',
          detailedPersona: 'pending',
          taskRecommendations: 'pending',
          understanding: 'completed',
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await consumed;

    expect(events.at(-1)?.phase).toBe('completed');
  });

  it('gives an LLM phase longer than the collection threshold', async () => {
    mockUnderstandingService.get.mockResolvedValue(writingSession());

    const { consumed, hasEnded } = await watch();
    const collecting = ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS['collecting-sources'];
    const writing = ONBOARDING_PROGRESS_STALL_THRESHOLDS_MS['generating-understanding'];
    expect(writing).toBeGreaterThan(collecting);

    await vi.advanceTimersByTimeAsync(collecting + 1_000);
    expect(hasEnded()).toBe(false);

    await vi.advanceTimersByTimeAsync(writing - collecting);
    await consumed;
    expect(hasEnded()).toBe(true);
  });

  it('ends a stream that keeps progressing before the platform limit', async () => {
    let revision = 1;
    mockUnderstandingService.get.mockImplementation(async () => {
      revision += 1;
      return collectingSession(revision);
    });

    const { consumed, events } = await watch();
    await vi.advanceTimersByTimeAsync(ONBOARDING_PROGRESS_STREAM_BUDGET_MS);
    await consumed;

    expect(ONBOARDING_PROGRESS_STREAM_BUDGET_MS).toBeLessThan(299_000);
    expect(events.at(-1)).toMatchObject({ phase: 'stalled', stalledReason: 'stream-budget' });
  });

  it('counts a slow initial read against the stream budget', async () => {
    const slowRead = 60_000;
    let revision = 1;
    mockUnderstandingService.get.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, slowRead));
      return collectingSession(revision);
    });
    mockUnderstandingService.get.mockImplementation(async () => {
      revision += 1;
      return collectingSession(revision);
    });

    const { consumed, events, hasEnded } = await watch();
    await vi.advanceTimersByTimeAsync(ONBOARDING_PROGRESS_STREAM_BUDGET_MS - 1_000);
    expect(hasEnded()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await consumed;

    expect(events.at(-1)).toMatchObject({ phase: 'stalled', stalledReason: 'stream-budget' });
  });

  it('still ends an empty session immediately without subscribing', async () => {
    mockUnderstandingService.get.mockResolvedValue({
      id: 'session-1',
      sources: {},
      status: 'pending',
    });

    const { consumed, events } = await watch();
    await consumed;

    expect(events.map(({ phase }) => phase)).toEqual(['collecting-sources']);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
