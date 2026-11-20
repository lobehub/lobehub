import {
  StaleUnderstandingRevisionError,
  StaleUnderstandingSessionError,
} from '@lobechat/database';
import type { OnboardingUnderstandingSession } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHarness, createSession, providerState } from './testUtils';

const { mockAssertWorkflowAvailable, mockTriggerProviders, mockTriggerWriting } = vi.hoisted(
  () => ({
    mockAssertWorkflowAvailable: vi.fn(),
    mockTriggerProviders: vi.fn(),
    mockTriggerWriting: vi.fn(),
  }),
);

vi.mock('@/server/workflows/onboardingUnderstanding', () => ({
  OnboardingUnderstandingWorkflow: {
    assertAvailable: mockAssertWorkflowAvailable,
    triggerProviders: mockTriggerProviders,
    triggerWriting: mockTriggerWriting,
  },
}));

const fingerprint = 'github@1';
const sessionRef = { sessionId: 'session-1', topicId: 'topic-1' };

const completedWriting = (
  detailed?: NonNullable<OnboardingUnderstandingSession['writing']>['detailed'],
  sourceFingerprint = fingerprint,
): OnboardingUnderstandingSession =>
  ({
    ...createSession({ github: providerState('completed', 1) }),
    feedback: { revision: 2, turns: [] },
    writing: {
      detailed,
      feedbackRevision: 2,
      generationRevision: 3,
      resultMessageId: 'assistant-1',
      sourceFingerprint,
      status: 'completed',
      updatedAt: '2026-07-20T00:00:00.000Z',
    },
  }) as OnboardingUnderstandingSession;

const staleErrors = [
  new StaleUnderstandingRevisionError('provider', 1),
  new StaleUnderstandingSessionError('session-1'),
];

describe('UnderstandingService guards and compensation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerProviders.mockResolvedValue({ workflowRunId: 'workflow-1' });
  });

  it('fails a provider attempt with a retryable collection error', async () => {
    const harness = createHarness(createSession({ github: providerState('running', 1) }));

    await harness.service.failProvider({ ...sessionRef, providerId: 'github', revision: 1 });

    expect(harness.repository.failProvider).toHaveBeenCalledWith({
      errors: [
        {
          code: 'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
          message: 'github collection failed',
          operation: 'collection',
          provider: 'github',
          retryable: true,
        },
      ],
      failedCount: 1,
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      succeededCount: 0,
      topicId: 'topic-1',
    });
  });

  it.each(staleErrors)('ignores a stale provider failure ($name)', async (error) => {
    const harness = createHarness(createSession({ github: providerState('running', 1) }));
    harness.repository.failProvider.mockRejectedValueOnce(error);

    await expect(
      harness.service.failProvider({ ...sessionRef, providerId: 'github', revision: 1 }),
    ).resolves.toBeUndefined();
  });

  it('rethrows any other provider failure error', async () => {
    const harness = createHarness(createSession({ github: providerState('running', 1) }));
    harness.repository.failProvider.mockRejectedValueOnce(new Error('db down'));

    await expect(
      harness.service.failProvider({ ...sessionRef, providerId: 'github', revision: 1 }),
    ).rejects.toThrow('db down');
  });

  it('returns stale for a provider revision that is no longer current', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 2) }));

    await expect(
      harness.service.processProvider({ ...sessionRef, providerId: 'github', revision: 1 }),
    ).resolves.toEqual({
      failedCount: 0,
      providerId: 'github',
      revision: 1,
      sourceCount: 0,
      status: 'stale',
      succeededCount: 0,
    });
    expect(harness.githubCollect).not.toHaveBeenCalled();
  });

  it('marks the provider failed and rethrows when a retry cannot be dispatched', async () => {
    const harness = createHarness(
      createSession({
        github: {
          ...providerState('failed', 1),
          errors: [
            {
              code: 'X',
              message: 'x',
              operation: 'collection',
              provider: 'github',
              retryable: true,
            },
          ],
        },
      }),
    );
    mockTriggerProviders.mockRejectedValueOnce(new Error('workflow down'));

    await expect(
      harness.service.retry({ ...sessionRef, providerId: 'github', responseLanguage: 'en-US' }),
    ).rejects.toThrow('workflow down');
    expect(harness.repository.failProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'github', revision: 2 }),
    );
  });

  it('fails every recollection attempt and rethrows the trigger error when revise cannot dispatch', async () => {
    const harness = createHarness(
      createSession({
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      }),
    );
    mockTriggerProviders.mockRejectedValueOnce(new Error('workflow down'));
    harness.repository.failProvider.mockRejectedValueOnce(new Error('db down'));

    await expect(
      harness.service.revise({
        expectedFeedbackRevision: 0,
        providerIds: [],
        responseLanguage: 'en-US',
        ...sessionRef,
      }),
    ).rejects.toThrow('workflow down');
    expect(harness.repository.failProvider).toHaveBeenCalledTimes(2);
    expect(harness.repository.failProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'github', revision: 2 }),
    );
    expect(harness.repository.failProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'gmail', revision: 2 }),
    );
  });

  it('returns the published result when the writing already completed', async () => {
    const harness = createHarness(completedWriting());

    await expect(
      harness.service.processCollected({
        ...sessionRef,
        expectedSourceFingerprint: fingerprint,
        responseLanguage: 'en-US',
      }),
    ).resolves.toEqual({
      feedbackRevision: 2,
      generationRevision: 3,
      published: true,
      resultId: 'assistant-1',
      sourceFingerprint: fingerprint,
    });
    expect(harness.writerAgent).not.toHaveBeenCalled();
  });

  it('does not fail a writing that belongs to another fingerprint', async () => {
    const harness = createHarness(completedWriting(undefined, 'gmail@1'));

    await expect(
      harness.service.failWriting({ ...sessionRef, sourceFingerprint: fingerprint }),
    ).resolves.toBeUndefined();
    expect(harness.repository.failWriting).not.toHaveBeenCalled();
  });

  it.each(staleErrors)('ignores a stale writing failure ($name)', async (error) => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.repository.failWriting.mockRejectedValueOnce(error);

    await expect(
      harness.service.failWriting({ ...sessionRef, sourceFingerprint: fingerprint }),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      expected: { published: false, sourceFingerprint: fingerprint },
      name: 'no completed writing',
      session: createSession({ github: providerState('completed', 1) }),
    },
    {
      expected: { published: true, sourceFingerprint: fingerprint },
      name: 'a completed detailed pass',
      session: completedWriting({ status: 'completed', updatedAt: '2026-07-20T00:00:00.000Z' }),
    },
    {
      expected: { published: false, sourceFingerprint: fingerprint },
      name: 'no running detailed pass',
      session: completedWriting(),
    },
  ])('settles the detailed persona early for $name', async ({ expected, session }) => {
    const harness = createHarness(session);

    await expect(
      harness.service.processDetailedPersona({
        ...sessionRef,
        expectedSourceFingerprint: fingerprint,
        responseLanguage: 'en-US',
      }),
    ).resolves.toEqual(expected);
    expect(harness.generateObject).not.toHaveBeenCalled();
  });

  it('fails only a running detailed pass', async () => {
    const idle = createHarness(completedWriting());
    await expect(
      idle.service.failDetailedPersona({ ...sessionRef, sourceFingerprint: fingerprint }),
    ).resolves.toBeUndefined();
    expect(idle.repository.failDetailedWriting).not.toHaveBeenCalled();

    const running = createHarness(
      completedWriting({ status: 'running', updatedAt: '2026-07-20T00:00:00.000Z' }),
    );
    await running.service.failDetailedPersona({ ...sessionRef, sourceFingerprint: fingerprint });
    expect(running.repository.failDetailedWriting).toHaveBeenCalledWith({
      error: {
        code: 'UNDERSTANDING_DETAILED_WRITING_FAILED',
        message: 'understanding detailed-writing failed',
        operation: 'detailed-writing',
        provider: 'understanding',
        retryable: true,
      },
      feedbackRevision: 2,
      generationRevision: 3,
      sessionId: 'session-1',
      sourceFingerprint: fingerprint,
      topicId: 'topic-1',
    });
  });

  // Current behavior, pinned as is: `failDetailedPersona` returns the repository promise without
  // awaiting it, so its `catch` never sees a stale rejection and the error reaches the caller.
  it.each(staleErrors)('propagates a stale detailed failure ($name)', async (error) => {
    const harness = createHarness(
      completedWriting({ status: 'running', updatedAt: '2026-07-20T00:00:00.000Z' }),
    );
    harness.repository.failDetailedWriting.mockRejectedValueOnce(error);

    await expect(
      harness.service.failDetailedPersona({ ...sessionRef, sourceFingerprint: fingerprint }),
    ).rejects.toBe(error);
  });
});
