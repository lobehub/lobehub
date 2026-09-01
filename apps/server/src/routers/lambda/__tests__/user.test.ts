// @vitest-environment node
import {
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
  UnderstandingPreconditionError,
  UnderstandingSessionNotFoundError,
} from '@lobechat/database';
import { Plans } from '@lobechat/types';
import { isTrackedEnvelope } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getReferralStatus,
  getSubscriptionPlan,
  onUserActivityForBusiness,
} from '@/business/server/user';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { serverDB } from '@/database/server';
import { router } from '@/libs/trpc/lambda';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { UnderstandingWorkflowUnavailableError } from '@/server/workflows/onboardingUnderstanding';

import { userRouter } from '../user';

// mounts userRouter under its production namespace so the apiKeyScopeGuard
// derives the real `user.*` path for API-key-authenticated calls
const namespacedRouter = router({ user: userRouter });

const mockAfterTasks = vi.hoisted((): Promise<void>[] => []);
const mockUnderstandingService = vi.hoisted(() => ({
  confirm: vi.fn(),
  get: vi.fn(),
  listSourceProviderIds: vi.fn(),
  revise: vi.fn(),
  retry: vi.fn(),
  start: vi.fn(),
}));
const mockCreateUnderstandingService = vi.hoisted(() => vi.fn());
const mockTaskRecommendationService = vi.hoisted(() => ({ get: vi.fn() }));
const mockCreateTaskRecommendationService = vi.hoisted(() => vi.fn());

// Mock modules
vi.mock('@/server/utils/scheduleAfterResponse', () => ({
  after: (callback: () => Promise<void> | void) => {
    mockAfterTasks.push(Promise.resolve(callback()));
  },
}));

vi.mock('@lobechat/database', () => {
  class StaleUnderstandingSessionError extends Error {}
  class StaleUnderstandingRevisionError extends Error {}
  class UnderstandingPreconditionError extends Error {}
  class UnderstandingResourceNotFoundError extends Error {}
  class UnderstandingSessionNotFoundError extends Error {}

  return {
    StaleUnderstandingSessionError,
    StaleUnderstandingRevisionError,
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

vi.mock('@/database/server', () => ({
  serverDB: {},
}));

vi.mock('@/database/models/message');
vi.mock('@/database/models/rbac');
vi.mock('@/database/models/session');
vi.mock('@/database/models/user');
vi.mock('@/server/modules/KeyVaultsEncrypt');
vi.mock('@/server/modules/S3');
vi.mock('@/server/services/user');
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: mockCreateUnderstandingService,
}));
vi.mock('@/server/services/taskRecommendation/service', () => {
  class TaskRecommendationNotFoundError extends Error {}

  return {
    createTaskRecommendationService: mockCreateTaskRecommendationService,
    TaskRecommendationNotFoundError,
  };
});
vi.mock('@/server/workflows/onboardingUnderstanding', () => {
  class UnderstandingWorkflowUnavailableError extends Error {}

  return {
    UnderstandingWorkflowUnavailableError,
  };
});

describe('userRouter', () => {
  const mockUserId = 'test-user-id';
  const mockCtx = {
    userId: mockUserId,
  };

  const flushAfterTasks = async () => {
    await Promise.all(mockAfterTasks.splice(0));
  };

  beforeEach(() => {
    mockAfterTasks.length = 0;
    vi.clearAllMocks();
    for (const method of Object.values(mockUnderstandingService)) method.mockReset();
    mockCreateUnderstandingService.mockReset();
    mockTaskRecommendationService.get.mockReset();
    mockCreateTaskRecommendationService.mockReset();
    vi.mocked(getReferralStatus).mockResolvedValue(undefined);
    vi.mocked(getSubscriptionPlan).mockResolvedValue(Plans.Free);
    vi.mocked(onUserActivityForBusiness).mockResolvedValue(undefined);
    mockCreateUnderstandingService.mockResolvedValue(mockUnderstandingService);
    mockCreateTaskRecommendationService.mockResolvedValue(mockTaskRecommendationService);
  });

  describe('onboarding understanding', () => {
    const pollingResult = { id: 'session-1', sources: {}, status: 'pending' as const };
    const scopedCtx = mockCtx;
    const workspaceCtx = { ...mockCtx, workspaceId: 'workspace-1' };

    it('returns supported apps separately from currently available sources', async () => {
      /** @example Gmail and Notion remain connectable while only GitHub is currently usable. */
      mockUnderstandingService.listSourceProviderIds.mockResolvedValueOnce(['github']);

      // ROOT CAUSE:
      //
      // The supported-provider expectation still listed only GitHub and Gmail after Notion was
      // registered, so the router correctly returned one more provider than the stale assertion.
      //
      // We keep the expectation aligned with the provider registry while preserving the separate
      // sourceProviderIds assertion for providers that are currently usable by this user.
      await expect(
        userRouter.createCaller(scopedCtx).getSupportedUnderstandingProviders(),
      ).resolves.toEqual({
        connectionSources: {
          github: 'lobehub',
          gmail: 'composio',
          notion: 'composio',
          twitter: 'lobehub',
        },
        providerIds: ['github', 'gmail', 'notion', 'twitter'],
        sourceProviderIds: ['github'],
      });
    });

    it('delegates start to the understanding service', async () => {
      mockUnderstandingService.start.mockResolvedValueOnce(pollingResult);

      const result = await userRouter
        .createCaller(scopedCtx)
        .startOnboardingUnderstanding({ responseLanguage: 'en-US', topicId: 'topic-1' });

      expect(mockCreateUnderstandingService).toHaveBeenCalledWith({
        db: serverDB,
        userId: mockUserId,
      });
      expect(mockUnderstandingService.start).toHaveBeenCalledWith('topic-1', 'en-US');
      expect(result).toEqual(pollingResult);
    });

    it('maps unavailable workflow before start writes state', async () => {
      mockUnderstandingService.start.mockRejectedValueOnce(
        new UnderstandingWorkflowUnavailableError(),
      );

      await expect(
        userRouter
          .createCaller(scopedCtx)
          .startOnboardingUnderstanding({ responseLanguage: 'en-US', topicId: 'topic-1' }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Onboarding understanding workflow is unavailable',
      });
    });

    it('maps unavailable workflow during retry', async () => {
      mockUnderstandingService.retry.mockRejectedValueOnce(
        new UnderstandingWorkflowUnavailableError(),
      );

      await expect(
        userRouter.createCaller(scopedCtx).retryOnboardingUnderstandingSource({
          sessionId: 'session-1',
          providerId: 'github',
          responseLanguage: 'en-US',
          topicId: 'topic-1',
        }),
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    });

    it('denies workspace polling before constructing the service', async () => {
      await expect(
        userRouter.createCaller(workspaceCtx).getOnboardingUnderstanding({ topicId: 'topic-1' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockCreateUnderstandingService).not.toHaveBeenCalled();
    });

    it.each([
      ['startOnboardingUnderstanding', { topicId: 'topic-1' }],
      [
        'retryOnboardingUnderstandingSource',
        { providerId: 'github', sessionId: 'session-1', topicId: 'topic-1' },
      ],
      [
        'confirmOnboardingUnderstanding',
        { resultId: 'result-1', sessionId: 'session-1', topicId: 'topic-1' },
      ],
      [
        'reviseOnboardingUnderstanding',
        {
          feedback: 'Focus on infrastructure.',
          providerIds: ['gmail'],
          sessionId: 'session-1',
          topicId: 'topic-1',
        },
      ],
    ] as const)('denies workspace access to %s', async (procedure, input) => {
      const caller = userRouter.createCaller(workspaceCtx);

      await expect(
        (caller[procedure] as (value: any) => Promise<unknown>)(input),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockCreateUnderstandingService).not.toHaveBeenCalled();
    });

    it('polls with a pure service read', async () => {
      mockUnderstandingService.get.mockResolvedValueOnce(pollingResult);

      const result = await userRouter
        .createCaller(scopedCtx)
        .getOnboardingUnderstanding({ topicId: 'topic-1' });

      expect(mockUnderstandingService.get).toHaveBeenCalledWith('topic-1');
      expect(result).toEqual(pollingResult);
      expect(mockUnderstandingService.start).not.toHaveBeenCalled();
      expect(mockUnderstandingService.retry).not.toHaveBeenCalled();
    });

    /** @example A completed session emits one tracked event and closes the SSE stream. */
    it('streams persisted progress without exposing generated onboarding content', async () => {
      mockUnderstandingService.get.mockResolvedValueOnce({
        id: 'session-1',
        sources: {
          github: {
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed',
            succeededCount: 2,
          },
        },
        status: 'completed',
        writing: {
          resultMessageId: 'message-1',
          sourceFingerprint: 'github@1',
          status: 'completed',
          updatedAt: '2026-08-09T00:00:00.000Z',
        },
      });
      mockTaskRecommendationService.get.mockResolvedValueOnce(undefined);

      const stream = await userRouter
        .createCaller(scopedCtx)
        .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();

      expect(first.done).toBe(false);
      if (first.done) throw new Error('Expected the progress stream to emit its initial state');
      expect(isTrackedEnvelope(first.value)).toBe(true);
      if (!isTrackedEnvelope(first.value)) throw new Error('Expected a tracked progress event');
      expect(first.value[0]).toContain('session-1');
      expect(first.value[1]).toEqual({
        phase: 'completed',
        sessionId: 'session-1',
        steps: {
          collectSources: 'completed',
          detailedPersona: 'pending',
          taskRecommendations: 'pending',
          understanding: 'completed',
        },
      });
      await expect(iterator.next()).resolves.toMatchObject({ done: true });
    });

    /** @example An initialized session without a connected provider is still collecting sources. */
    it('keeps an empty pending session in the collecting-sources phase', async () => {
      mockUnderstandingService.get.mockResolvedValueOnce({
        id: 'session-1',
        sources: {},
        status: 'pending',
      });
      mockTaskRecommendationService.get.mockResolvedValueOnce(undefined);

      const stream = await userRouter
        .createCaller(scopedCtx)
        .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();

      expect(first.done).toBe(false);
      if (first.done) throw new Error('Expected the pending progress event');
      expect(isTrackedEnvelope(first.value)).toBe(true);
      if (!isTrackedEnvelope(first.value)) throw new Error('Expected a tracked progress event');
      expect(first.value[1]).toEqual({
        phase: 'collecting-sources',
        sessionId: 'session-1',
        steps: {
          collectSources: 'pending',
          detailedPersona: 'pending',
          taskRecommendations: 'pending',
          understanding: 'pending',
        },
      });
      await iterator.return?.();
    });

    /** @example A completed source waits for the downstream writer instead of ending the stream. */
    it('keeps the durable downstream scheduling window active after the last source completes', async () => {
      mockUnderstandingService.get.mockResolvedValueOnce({
        id: 'session-1',
        sources: {
          github: {
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed',
            succeededCount: 2,
          },
        },
        status: 'processing',
      });
      mockTaskRecommendationService.get.mockResolvedValueOnce(undefined);

      const stream = await userRouter
        .createCaller(scopedCtx)
        .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();

      expect(first.done).toBe(false);
      if (first.done || !isTrackedEnvelope(first.value)) {
        throw new Error('Expected a tracked progress event during downstream scheduling');
      }
      expect(first.value[1]).toMatchObject({
        phase: 'generating-understanding',
        steps: { understanding: 'pending' },
      });
      await iterator.return?.();
    });

    /** @example The UI can distinguish each active generation stage without receiving content. */
    it('projects writing, detailed-persona, and task-recommendation stages', async () => {
      const cases = [
        {
          expectedPhase: 'generating-understanding',
          taskRecommendations: undefined,
          writing: { status: 'running' as const, updatedAt: '2026-08-09T00:00:00.000Z' },
        },
        {
          expectedPhase: 'generating-detailed-persona',
          taskRecommendations: undefined,
          writing: {
            detailed: { status: 'running' as const, updatedAt: '2026-08-09T00:00:00.000Z' },
            status: 'completed' as const,
            updatedAt: '2026-08-09T00:00:00.000Z',
          },
        },
        {
          expectedPhase: 'recommending-tasks',
          taskRecommendations: { status: 'processing' as const },
          writing: { status: 'completed' as const, updatedAt: '2026-08-09T00:00:00.000Z' },
        },
      ];

      for (const { expectedPhase, taskRecommendations, writing } of cases) {
        mockUnderstandingService.get.mockResolvedValueOnce({
          id: 'session-1',
          sources: {
            github: {
              errors: [],
              failedCount: 0,
              revision: 1,
              status: 'completed',
              succeededCount: 2,
            },
          },
          status: 'processing',
          writing,
        });
        mockTaskRecommendationService.get.mockResolvedValueOnce(taskRecommendations);

        const stream = await userRouter
          .createCaller(scopedCtx)
          .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();

        expect(first.done).toBe(false);
        if (first.done || !isTrackedEnvelope(first.value)) {
          throw new Error('Expected a tracked active progress event');
        }
        expect(first.value[1]).toMatchObject({ phase: expectedPhase });
        await iterator.return?.();
      }
    });

    /** @example A reconnect cursor suppresses a duplicate terminal progress event. */
    it('deduplicates a persisted terminal event after reconnecting with its tracked cursor', async () => {
      const understanding = {
        id: 'session-1',
        sources: {
          github: {
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed' as const,
            succeededCount: 2,
          },
        },
        status: 'completed' as const,
        writing: {
          resultMessageId: 'message-1',
          sourceFingerprint: 'github@1',
          status: 'completed' as const,
          updatedAt: '2026-08-09T00:00:00.000Z',
        },
      };
      mockUnderstandingService.get.mockResolvedValue(understanding);
      mockTaskRecommendationService.get.mockResolvedValue(undefined);

      const firstStream = await userRouter
        .createCaller(scopedCtx)
        .watchOnboardingGenerationProgress({ topicId: 'topic-1' });
      const first = await firstStream[Symbol.asyncIterator]().next();
      if (first.done) throw new Error('Expected the initial progress event');
      expect(isTrackedEnvelope(first.value)).toBe(true);
      if (!isTrackedEnvelope(first.value)) throw new Error('Expected a tracked progress event');

      const resumedStream = await userRouter
        .createCaller(scopedCtx)
        .watchOnboardingGenerationProgress({ lastEventId: first.value[0], topicId: 'topic-1' });

      await expect(resumedStream[Symbol.asyncIterator]().next()).resolves.toMatchObject({
        done: true,
      });
    });

    it('delegates retry for only the requested provider', async () => {
      mockUnderstandingService.retry.mockResolvedValueOnce(pollingResult);

      const result = await userRouter.createCaller(scopedCtx).retryOnboardingUnderstandingSource({
        sessionId: 'session-1',
        providerId: 'github',
        responseLanguage: 'en-US',
        topicId: 'topic-1',
      });

      expect(mockUnderstandingService.retry).toHaveBeenCalledWith({
        providerId: 'github',
        responseLanguage: 'en-US',
        sessionId: 'session-1',
        topicId: 'topic-1',
      });
      expect(result).toEqual(pollingResult);
    });

    /**
     * @example
     * expect(result.status).toBe('processing');
     */
    it('delegates cumulative feedback and additive sources', async () => {
      mockUnderstandingService.revise.mockResolvedValueOnce({
        ...pollingResult,
        status: 'processing',
      });
      const input = {
        expectedFeedbackRevision: 0,
        feedback: 'Focus on infrastructure.',
        providerIds: ['gmail'],
        responseLanguage: 'en-US',
        sessionId: 'session-1',
        topicId: 'topic-1',
      };

      const result = await userRouter.createCaller(scopedCtx).reviseOnboardingUnderstanding(input);

      expect(mockUnderstandingService.revise).toHaveBeenCalledWith(input);
      expect(result).toMatchObject({ status: 'processing' });
    });

    it('delegates confirmation and returns the created persona version', async () => {
      const confirmation = { personaVersion: 3 };
      mockUnderstandingService.confirm.mockResolvedValueOnce(confirmation);

      const result = await userRouter.createCaller(scopedCtx).confirmOnboardingUnderstanding({
        resultId: 'result-1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      });

      expect(mockUnderstandingService.confirm).toHaveBeenCalledWith({
        resultId: 'result-1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      });
      expect(result).toEqual({
        confirmed: true,
        personaVersion: 3,
        resultId: 'result-1',
        sessionId: 'session-1',
      });
    });

    it('rejects caller-supplied user and workspace identities', async () => {
      const caller = userRouter.createCaller(scopedCtx);
      const start = caller.startOnboardingUnderstanding as (input: unknown) => Promise<unknown>;

      await expect(
        start({
          topicId: 'topic-1',
          userId: 'other-user',
          workspaceId: 'other-workspace',
        }),
      ).rejects.toThrow();
      expect(mockUnderstandingService.start).not.toHaveBeenCalled();
    });

    it('maps missing or unowned resources to a safe not-found error', async () => {
      mockUnderstandingService.get.mockRejectedValueOnce(
        new UnderstandingSessionNotFoundError('private-topic-id'),
      );

      await expect(
        userRouter
          .createCaller(scopedCtx)
          .getOnboardingUnderstanding({ topicId: 'another-users-topic' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'Onboarding understanding was not found',
      });
    });

    it('maps stale sessions to a safe conflict error', async () => {
      mockUnderstandingService.retry.mockRejectedValueOnce(
        new StaleUnderstandingSessionError('private-session-id'),
      );

      await expect(
        userRouter.createCaller(scopedCtx).retryOnboardingUnderstandingSource({
          sessionId: 'another-users-session',
          providerId: 'github',
          responseLanguage: 'en-US',
          topicId: 'topic-1',
        }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'Onboarding understanding is no longer current',
      });
    });

    it('maps a stale confirmation fingerprint to a safe conflict error', async () => {
      mockUnderstandingService.confirm.mockRejectedValueOnce(
        new StaleUnderstandingRevisionError('writing', 'github@1'),
      );

      await expect(
        userRouter.createCaller(scopedCtx).confirmOnboardingUnderstanding({
          resultId: 'result-1',
          sessionId: 'session-1',
          topicId: 'topic-1',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('maps nonretryable providers to a safe precondition error', async () => {
      mockUnderstandingService.retry.mockRejectedValueOnce(
        new UnderstandingPreconditionError('source_not_retryable'),
      );

      await expect(
        userRouter.createCaller(scopedCtx).retryOnboardingUnderstandingSource({
          sessionId: 'session-1',
          providerId: 'github',
          responseLanguage: 'en-US',
          topicId: 'topic-1',
        }),
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        message: 'Onboarding understanding action is not currently available',
      });
    });

    it('does not expose unexpected repository or provider errors', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockUnderstandingService.confirm.mockRejectedValueOnce(
        new Error('redis://secret-token RAW_GMAIL_XML_SENTINEL'),
      );

      await expect(
        userRouter.createCaller(scopedCtx).confirmOnboardingUnderstanding({
          resultId: 'another-users-result',
          sessionId: 'session-1',
          topicId: 'topic-1',
        }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to process onboarding understanding request',
      });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-token');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('RAW_GMAIL_XML_SENTINEL');
      consoleError.mockRestore();
    });

    it('sanitizes service initialization failures', async () => {
      mockCreateUnderstandingService.mockRejectedValueOnce(
        new Error('oauth-secret-token RAW_GITHUB_MARKDOWN_SENTINEL'),
      );

      await expect(
        userRouter.createCaller(scopedCtx).getOnboardingUnderstanding({ topicId: 'topic-1' }),
      ).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to process onboarding understanding request',
      });
    });
  });

  describe('getUserActivitySummary', () => {
    it('returns the user-level activity summary', async () => {
      const summary = {
        lastUserMessageAt: new Date('2026-06-01T00:00:00.000Z'),
        userCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserActivitySummary: vi.fn().mockResolvedValue(summary),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserActivitySummary();

      expect(result).toEqual(summary);
      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('getUserRegistrationDuration', () => {
    it('should return registration duration', async () => {
      const mockDuration = { duration: 100, createdAt: '2023-01-01', updatedAt: '2023-01-02' };
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserRegistrationDuration: vi.fn().mockResolvedValue(mockDuration),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserRegistrationDuration();

      expect(result).toEqual(mockDuration);
      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('getUserSSOProviders', () => {
    it('should return SSO providers', async () => {
      const mockProviders = [
        {
          provider: 'google',
          providerAccountId: '123',
          userId: 'user-1',
          type: 'oauth',
        },
      ];
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            getUserSSOProviders: vi.fn().mockResolvedValue(mockProviders),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserSSOProviders();

      expect(result).toEqual(mockProviders);
      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('getUserState', () => {
    it('should return user state', async () => {
      const mockState = {
        isOnboarded: true,
        preference: { telemetry: true },
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            advanceLastActiveAt: vi.fn().mockResolvedValue(undefined),
            getUserState: vi.fn().mockResolvedValue(mockState),
            updateUser: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(5),
          }) as any,
      );

      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(true),
          }) as any,
      );

      const result = await userRouter.createCaller({ ...mockCtx }).getUserState();

      expect(result).toMatchObject({
        isOnboard: true,
        preference: { telemetry: true },
        settings: {},
        hasConversation: true,
        canEnablePWAGuide: true,
        canEnableTrace: true,
        userId: mockUserId,
      });
    });

    it('should invoke the user activity hook after winning the lastActiveAt update', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const previousLastActiveAt = new Date('2026-03-01T00:00:00.000Z');
      const advanceLastActiveAt = vi.fn().mockResolvedValue({
        previousLastActiveAt,
        userCreatedAt: createdAt,
      });
      const mockState = {
        isOnboarded: true,
        preference: {},
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            advanceLastActiveAt,
            getUserState: vi.fn().mockResolvedValue(mockState),
          }) as any,
      );
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(0),
          }) as any,
      );
      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).getUserState();
      await flushAfterTasks();

      expect(advanceLastActiveAt).toHaveBeenCalledWith(expect.any(Date));
      expect(onUserActivityForBusiness).toHaveBeenCalledWith({
        currentTime: expect.any(Date),
        previousLastActiveAt,
        userCreatedAt: createdAt,
        userId: mockUserId,
      });
    });

    it('should skip the user activity hook when a concurrent request already updated lastActiveAt', async () => {
      const advanceLastActiveAt = vi.fn().mockResolvedValue(undefined);
      const mockState = {
        isOnboarded: true,
        preference: {},
        settings: {},
        userId: mockUserId,
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            advanceLastActiveAt,
            getUserState: vi.fn().mockResolvedValue(mockState),
          }) as any,
      );
      vi.mocked(MessageModel).mockImplementation(
        () =>
          ({
            countUpTo: vi.fn().mockResolvedValue(0),
          }) as any,
      );
      vi.mocked(SessionModel).mockImplementation(
        () =>
          ({
            hasMoreThanN: vi.fn().mockResolvedValue(false),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).getUserState();
      await flushAfterTasks();

      expect(advanceLastActiveAt).toHaveBeenCalledWith(expect.any(Date));
      expect(onUserActivityForBusiness).not.toHaveBeenCalled();
    });
  });

  describe('makeUserOnboarded', () => {
    it('should update user onboarded status', async () => {
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateUser: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).makeUserOnboarded();

      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });
  });

  describe('updateSettings', () => {
    it('should update settings with encrypted key vaults', async () => {
      const mockSettings = {
        keyVaults: { openai: { key: 'test-key' } },
        general: { language: 'en-US' },
      };

      const mockEncryptedVaults = 'encrypted-data';
      const mockGateKeeper = {
        encrypt: vi.fn().mockResolvedValue(mockEncryptedVaults),
      };

      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings(mockSettings);

      expect(mockGateKeeper.encrypt).toHaveBeenCalledWith(JSON.stringify(mockSettings.keyVaults));
    });

    it('rejects keyVaults updates from restricted keys without model:write', async () => {
      await expect(
        namespacedRouter
          .createCaller({ ...mockCtx, apiKeyScopes: ['user:write'] })
          .user.updateSettings({ keyVaults: { openai: { key: 'stolen' } } }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('model:write'),
      });
    });

    it('rejects market token updates from restricted keys without model:write', async () => {
      await expect(
        namespacedRouter
          .createCaller({ ...mockCtx, apiKeyScopes: ['user:write'] })
          .user.updateSettings({ market: { accessToken: 'x' } } as any),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('model:write'),
      });
    });

    it('rejects keyVaults clears (null) from restricted keys without model:write', async () => {
      await expect(
        namespacedRouter
          .createCaller({ ...mockCtx, apiKeyScopes: ['user:write'] })
          .user.updateSettings({ keyVaults: null } as any),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: expect.stringContaining('model:write'),
      });
    });

    it('does not touch stored keyVaults when the field is omitted', async () => {
      const updateSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(UserModel).mockImplementation(() => ({ updateSetting }) as any);

      await userRouter.createCaller({ ...mockCtx }).updateSettings({
        general: { language: 'en-US' },
      } as any);

      expect(updateSetting.mock.calls[0][0]).not.toHaveProperty('keyVaults');
    });

    it('allows keyVaults updates from restricted keys holding model:write', async () => {
      const mockGateKeeper = { encrypt: vi.fn().mockResolvedValue('encrypted') };
      vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await namespacedRouter
        .createCaller({ ...mockCtx, apiKeyScopes: ['user:write', 'model:write'] })
        .user.updateSettings({ keyVaults: { openai: { key: 'mine' } } });

      expect(mockGateKeeper.encrypt).toHaveBeenCalled();
    });

    it('should update settings without key vaults', async () => {
      const mockSettings = {
        general: { language: 'en-US' },
      };

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting: vi.fn().mockResolvedValue({ rowCount: 1 }),
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings(mockSettings);

      expect(UserModel).toHaveBeenCalledWith(serverDB, mockUserId);
    });

    it('should allow legacy system agent model-only fields', async () => {
      const updateSetting = vi.fn().mockResolvedValue({ rowCount: 1 });

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting,
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings({
        systemAgent: {
          queryRewrite: { model: 'ag/gemini-3.1-pro-high' },
          topic: { model: 'ag/gemini-3.1-pro-high' },
        },
      });

      expect(updateSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          systemAgent: {
            queryRewrite: { model: 'ag/gemini-3.1-pro-high' },
            topic: { model: 'ag/gemini-3.1-pro-high' },
          },
        }),
      );
    });

    it('should allow legacy scalar system agent fields', async () => {
      const updateSetting = vi.fn().mockResolvedValue({ rowCount: 1 });

      vi.mocked(UserModel).mockImplementation(
        () =>
          ({
            updateSetting,
          }) as any,
      );

      await userRouter.createCaller({ ...mockCtx }).updateSettings({
        systemAgent: {
          enableAutoReply: true,
          replyMessage: 'Custom auto reply',
        },
      });

      expect(updateSetting).toHaveBeenCalledWith(
        expect.objectContaining({
          systemAgent: {
            enableAutoReply: true,
            replyMessage: 'Custom auto reply',
          },
        }),
      );
    });
  });

  describe('updateToolIntervention', () => {
    it('delegates to the atomic model merge with the raw input', async () => {
      const mergeToolInterventionSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(UserModel).mockImplementation(() => ({ mergeToolInterventionSetting }) as any);

      await userRouter.createCaller({ ...mockCtx }).updateToolIntervention({
        appendAllowList: ['bash/bash'],
        approvalMode: 'auto-run',
      });

      // Merge semantics (sibling-key preservation, allowList union, concurrency)
      // are covered by the UserModel integration tests against a real database.
      expect(mergeToolInterventionSetting).toHaveBeenCalledWith({
        appendAllowList: ['bash/bash'],
        approvalMode: 'auto-run',
      });
    });

    it('rejects workspace members without content permission', async () => {
      const { RbacModel } = await import('@/database/models/rbac');
      vi.mocked(RbacModel).mockImplementation(
        () => ({ hasAnyPermission: vi.fn().mockResolvedValue(false) }) as any,
      );

      await expect(
        userRouter
          .createCaller({ ...mockCtx, workspaceId: 'ws_1' } as any)
          .updateToolIntervention({ approvalMode: 'auto-run' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows workspace members holding content permission', async () => {
      const { RbacModel } = await import('@/database/models/rbac');
      vi.mocked(RbacModel).mockImplementation(
        () => ({ hasAnyPermission: vi.fn().mockResolvedValue(true) }) as any,
      );

      const mergeToolInterventionSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(UserModel).mockImplementation(() => ({ mergeToolInterventionSetting }) as any);

      await userRouter
        .createCaller({ ...mockCtx, workspaceId: 'ws_1' } as any)
        .updateToolIntervention({ approvalMode: 'auto-run' });

      expect(mergeToolInterventionSetting).toHaveBeenCalledWith({ approvalMode: 'auto-run' });
    });
  });

  describe('updateUninstalledBuiltinTools', () => {
    it('patches the slot pinned by the input workspace, gated on that workspace', async () => {
      const { RbacModel } = await import('@/database/models/rbac');
      const hasAnyPermission = vi.fn().mockResolvedValue(true);
      vi.mocked(RbacModel).mockImplementation(() => ({ hasAnyPermission }) as any);

      const replaceUninstalledBuiltinToolsSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(UserModel).mockImplementation(
        () => ({ replaceUninstalledBuiltinToolsSetting }) as any,
      );

      // ctx carries a DIFFERENT workspace than the pinned target — the write and
      // the RBAC check must both follow the pinned input scope, not the header.
      await userRouter
        .createCaller({ ...mockCtx, workspaceId: 'ws_other' } as any)
        .updateUninstalledBuiltinTools({ uninstalledBuiltinTools: ['dalle'], workspaceId: 'ws_1' });

      expect(hasAnyPermission).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'ws_1' });
      expect(replaceUninstalledBuiltinToolsSetting).toHaveBeenCalledWith({
        uninstalledBuiltinTools: ['dalle'],
        workspaceId: 'ws_1',
      });
    });

    it('targets the personal scope when the pinned workspace is null', async () => {
      const replaceUninstalledBuiltinToolsSetting = vi.fn().mockResolvedValue({ rowCount: 1 });
      vi.mocked(UserModel).mockImplementation(
        () => ({ replaceUninstalledBuiltinToolsSetting }) as any,
      );

      await userRouter
        .createCaller({ ...mockCtx })
        .updateUninstalledBuiltinTools({ uninstalledBuiltinTools: [], workspaceId: null });

      expect(replaceUninstalledBuiltinToolsSetting).toHaveBeenCalledWith({
        uninstalledBuiltinTools: [],
        workspaceId: null,
      });
    });

    it('rejects members without content permission on the target workspace', async () => {
      const { RbacModel } = await import('@/database/models/rbac');
      vi.mocked(RbacModel).mockImplementation(
        () => ({ hasAnyPermission: vi.fn().mockResolvedValue(false) }) as any,
      );

      await expect(
        userRouter
          .createCaller({ ...mockCtx, workspaceId: 'ws_1' } as any)
          .updateUninstalledBuiltinTools({
            uninstalledBuiltinTools: ['dalle'],
            workspaceId: 'ws_1',
          }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
