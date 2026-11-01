// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { serializeStepResult } from '@/server/workflows/testing/stepContext';

import {
  failRunningUnderstandingProviders,
  processUnderstandingProviders,
} from './processProviders';

type TriggerTaskRecommendations = Parameters<
  typeof processUnderstandingProviders
>[1]['triggerTaskRecommendations'];

const errors = vi.hoisted(() => {
  class DomainError extends Error {}
  return { DomainError };
});

vi.mock('@lobechat/database', () => ({
  getUnderstandingSourceFingerprint: ({
    sources,
  }: {
    sources: Record<string, { revision: number; status: string }>;
  }) =>
    Object.entries(sources)
      .filter(([, source]) => source.status === 'completed')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerId, source]) => `${providerId}@${source.revision}`)
      .join(','),
  StaleUnderstandingSessionError: errors.DomainError,
  UnderstandingResourceNotFoundError: errors.DomainError,
  UnderstandingSessionNotFoundError: errors.DomainError,
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));

const payload = {
  providers: [
    { id: 'gmail', revision: 1 },
    { id: 'github', revision: 1 },
  ],
  responseLanguage: 'zh-CN',
  sessionId: 'session-1',
  startedAt: 1000,
  topicId: 'topic-1',
  userId: 'user-1',
};
const workflow = { options: {}, routeFunction: vi.fn(), workflowId: 'process-collected' };

const createContext = (requestPayload: unknown) => {
  const steps: string[] = [];
  const invocations: Array<{ settings: any; stepName: string }> = [];
  return {
    context: {
      invoke: vi.fn(async (stepName: string, settings: any) => {
        invocations.push({ settings, stepName });
        return { body: {} };
      }),
      requestPayload,
      run: async <T>(stepName: string, action: () => Promise<T>) => {
        steps.push(stepName);
        return serializeStepResult(await action());
      },
    },
    invocations,
    steps,
  };
};

const completed = (providerId: string, sourceFingerprint: string, revision = 1) => ({
  failedCount: 0,
  providerId,
  revision,
  sourceCount: 2,
  sourceFingerprint,
  status: 'completed' as const,
  succeededCount: 2,
});

describe('processUnderstandingProviders', () => {
  /**
   * @example A faster GitHub provider cannot create downstream steps before a slower Gmail provider.
   */
  it('separates concurrent provider collection from deterministic downstream scheduling', async () => {
    // ROOT CAUSE:
    //
    // If one provider completed before another, its async map callback immediately created writing
    // and recommendation steps. Upstash then persisted a parallel group whose membership depended on
    // completion timing, so replay could expect GitHub steps while receiving Twitter steps.
    //
    // Before: provider callbacks mixed collection and downstream workflow steps.
    // After: all collection steps settle before a sorted downstream step sequence is created.
    let releaseGmail!: () => void;
    const gmailGate = new Promise<void>((resolve) => (releaseGmail = resolve));
    const service = {
      processProvider: vi.fn(async ({ providerId }: { providerId: string }) => {
        if (providerId === 'gmail') await gmailGate;
        return completed(providerId, providerId === 'github' ? 'github@1' : 'github@1,gmail@1');
      }),
    };
    const { context, invocations, steps } = createContext(payload);
    const triggerTaskRecommendations = vi.fn<TriggerTaskRecommendations>(async () => undefined);
    const running = processUnderstandingProviders(context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
      triggerTaskRecommendations,
    });

    await vi.waitFor(() => expect(service.processProvider).toHaveBeenCalledTimes(2));
    expect(invocations).toHaveLength(0);
    expect(triggerTaskRecommendations).not.toHaveBeenCalled();
    releaseGmail();
    await running;

    expect(steps).toEqual([
      'provider:github:1:process',
      'provider:gmail:1:process',
      'provider:github:recommend:1',
      'provider:gmail:recommend:1',
    ]);
    expect(service.processProvider).toHaveBeenCalledWith({
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    expect(invocations).toHaveLength(2);
    expect(invocations.map(({ settings }) => settings.body.sourceFingerprint)).toEqual([
      'github@1',
      'github@1,gmail@1',
    ]);
    expect(invocations[0].settings.flowControl).toEqual({
      key: 'onboarding-understanding.writing.session-1',
      parallelism: 1,
    });
    expect(triggerTaskRecommendations).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceFingerprint: 'github@1' }),
      {
        flowControl: {
          key: 'onboarding-task-recommendation.session-1',
          parallelism: 1,
        },
        workflowRunId: expect.stringMatching(/^onboarding-task-recommendation-[a-f0-9]{32}$/),
      },
    );
    expect(JSON.stringify({ invocations, payload })).not.toMatch(/token|accountId|markdown|xml/i);
  });

  it('replays a commit-before-ack delivery with the same fingerprint child identity', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@2', 2)) };
    const attempt = { id: 'github', revision: 2 };
    const first = createContext({ ...payload, providers: [attempt] });
    const replay = createContext({ ...payload, providers: [attempt] });
    const triggerTaskRecommendations = vi.fn<TriggerTaskRecommendations>(async () => undefined);
    const dependencies = {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
      triggerTaskRecommendations,
    };

    await processUnderstandingProviders(first.context as never, dependencies);
    await processUnderstandingProviders(replay.context as never, dependencies);

    expect(service.processProvider).toHaveBeenCalledTimes(2);
    expect(first.invocations[0].settings.workflowRunId).toBe(
      replay.invocations[0].settings.workflowRunId,
    );
    expect(first.invocations[0].settings.workflowRunId).toMatch(
      /^onboarding-understanding-collected-[a-f0-9]{32}$/,
    );
    const firstRecommendationCall = triggerTaskRecommendations.mock.calls.at(0);
    const replayedRecommendationCall = triggerTaskRecommendations.mock.calls.at(1);
    expect(firstRecommendationCall).toBeDefined();
    expect(replayedRecommendationCall).toBeDefined();
    if (!firstRecommendationCall || !replayedRecommendationCall) {
      throw new Error('Expected both recommendation workflow triggers');
    }
    expect(firstRecommendationCall[1].workflowRunId).toBe(
      replayedRecommendationCall[1].workflowRunId,
    );
  });

  /**
   * @example A diagnostic run writes Understanding without implicitly starting task generation.
   */
  it('can suppress automatic task recommendations while preserving Understanding writing', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@1')) };
    const diagnostic = createContext({
      ...payload,
      providers: [{ id: 'github', revision: 1 }],
      triggerTaskRecommendations: false,
    });
    const triggerTaskRecommendations = vi.fn<TriggerTaskRecommendations>(async () => undefined);

    await processUnderstandingProviders(diagnostic.context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
      triggerTaskRecommendations,
    });

    expect(diagnostic.invocations).toHaveLength(1);
    expect(diagnostic.invocations[0].settings.body.sourceFingerprint).toBe('github@1');
    expect(triggerTaskRecommendations).not.toHaveBeenCalled();
  });

  it('does not invoke writing for terminal failure and lets transient errors retry', async () => {
    const terminal = createContext({
      ...payload,
      providers: [{ id: 'github', revision: 1 }],
    });
    await processUnderstandingProviders(terminal.context as never, {
      createService: async () =>
        ({
          processProvider: vi.fn(async () => ({ ...completed('github', ''), status: 'failed' })),
        }) as never,
      processCollectedWorkflow: workflow as never,
      triggerTaskRecommendations: vi.fn(async () => undefined),
    });
    expect(terminal.invocations).toHaveLength(0);

    const transient = new Error('connector temporarily unavailable');
    await expect(
      processUnderstandingProviders(terminal.context as never, {
        createService: async () =>
          ({
            processProvider: vi.fn(async () => {
              throw transient;
            }),
          }) as never,
        processCollectedWorkflow: workflow as never,
        triggerTaskRecommendations: vi.fn(async () => undefined),
      }),
    ).rejects.toBe(transient);
  });

  it('does not invoke writing for a stale provider attempt', async () => {
    const stale = createContext({
      ...payload,
      providers: [{ id: 'github', revision: 4 }],
    });
    await processUnderstandingProviders(stale.context as never, {
      createService: async () =>
        ({
          processProvider: vi.fn(async () => ({
            ...completed('github', 'github@5', 4),
            status: 'stale',
          })),
        }) as never,
      processCollectedWorkflow: workflow as never,
      triggerTaskRecommendations: vi.fn(async () => undefined),
    });

    expect(stale.invocations).toHaveLength(0);
  });

  it('rejects duplicate attempts and unsafe external payload fields', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@1')) };
    const duplicate = createContext({
      ...payload,
      providers: [
        { id: 'github', revision: 1 },
        { id: 'github', revision: 2 },
      ],
    });
    await expect(
      processUnderstandingProviders(duplicate.context as never, {
        createService: async () => service as never,
        processCollectedWorkflow: workflow as never,
        triggerTaskRecommendations: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow();

    const unsafe = createContext({
      ...payload,
      accessToken: 'secret',
      providers: [{ id: 'github:1', revision: 1 }],
    });
    await expect(
      processUnderstandingProviders(unsafe.context as never, {
        createService: vi.fn(),
        processCollectedWorkflow: workflow as never,
        triggerTaskRecommendations: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow();
  });
});

describe('failRunningUnderstandingProviders', () => {
  it('terminalizes only the selected target revision and ignores an older attempt', async () => {
    const service = {
      failProvider: vi.fn(async ({ revision }: { revision: number }) =>
        revision === 8 ? {} : undefined,
      ),
      failWriting: vi.fn(),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: {
          github: {
            errors: [],
            failedCount: 1,
            revision: 8,
            status: 'failed',
            succeededCount: 0,
          },
        },
      })),
    };
    const current = {
      ...payload,
      providers: [{ id: 'github', revision: 8 }],
    };
    await expect(
      failRunningUnderstandingProviders(current, { createService: async () => service as never }),
    ).resolves.toEqual({ failedProviderIds: ['github'] });
    expect(service.failProvider).toHaveBeenCalledWith({
      providerId: 'github',
      revision: 8,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    const oldAttempt = {
      ...payload,
      providers: [{ id: 'github', revision: 4 }],
    };
    await expect(
      failRunningUnderstandingProviders(oldAttempt, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ failedProviderIds: [] });
    expect(service.failProvider).toHaveBeenLastCalledWith({
      providerId: 'github',
      revision: 4,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
  });

  /** @example A provider workflow crash after collection projects the session as failed. */
  it('marks writing failed when all providers completed but downstream scheduling did not start', async () => {
    // ROOT CAUSE:
    //
    // The failure callback previously terminalized only running providers. If every provider had
    // already completed but downstream step replay failed, no state changed and polling remained
    // `processing` forever because the session had no writing state.
    //
    // We fixed this by creating a failed writing state for the completed source fingerprint.
    const service = {
      failProvider: vi.fn(async () => undefined),
      failWriting: vi.fn(async () => ({})),
      get: vi.fn(async () => ({
        generationRevision: 0,
        id: 'session-1',
        sources: {
          github: {
            completedAt: '2026-08-11T21:04:08.922Z',
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed',
            succeededCount: 10,
          },
          twitter: {
            completedAt: '2026-08-11T21:04:03.458Z',
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed',
            succeededCount: 3,
          },
        },
      })),
    };

    await failRunningUnderstandingProviders(
      {
        ...payload,
        providers: [
          { id: 'github', revision: 1 },
          { id: 'twitter', revision: 1 },
        ],
      },
      { createService: async () => service as never },
    );

    expect(service.failWriting).toHaveBeenCalledWith({
      sessionId: 'session-1',
      sourceFingerprint: 'github@1,twitter@1',
      topicId: 'topic-1',
    });
  });
});
