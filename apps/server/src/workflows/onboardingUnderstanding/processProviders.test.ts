// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  failRunningUnderstandingProviders,
  processUnderstandingProviders,
} from './processProviders';

const errors = vi.hoisted(() => {
  class DomainError extends Error {}
  return { DomainError };
});

vi.mock('@lobechat/database', () => ({
  StaleUnderstandingSessionError: errors.DomainError,
  UnderstandingResourceNotFoundError: errors.DomainError,
  UnderstandingSessionNotFoundError: errors.DomainError,
}));
vi.mock('@/database/server', () => ({ getServerDB: vi.fn() }));
vi.mock('@/server/services/understanding/service', () => ({
  createUnderstandingService: vi.fn(),
}));

const payload = {
  providerIds: ['gmail', 'github'],
  sessionId: 'session-1',
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
        return action();
      },
    },
    invocations,
    steps,
  };
};

const completed = (providerId: string, sourceFingerprint: string) => ({
  failedCount: 0,
  providerId,
  revision: 1,
  sourceCount: 2,
  sourceFingerprint,
  status: 'completed' as const,
  succeededCount: 2,
});

describe('processUnderstandingProviders', () => {
  it('runs one durable operation per provider concurrently and invokes each completed fingerprint immediately', async () => {
    let releaseGmail!: () => void;
    const gmailGate = new Promise<void>((resolve) => (releaseGmail = resolve));
    const service = {
      processProvider: vi.fn(async ({ providerId }: { providerId: string }) => {
        if (providerId === 'gmail') await gmailGate;
        return completed(providerId, providerId === 'github' ? 'github@1' : 'github@1,gmail@1');
      }),
    };
    const { context, invocations, steps } = createContext(payload);
    const running = processUnderstandingProviders(context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
    });

    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    expect(invocations[0].settings.body).toEqual({
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
      userId: 'user-1',
    });
    releaseGmail();
    await running;

    expect(steps).toEqual(['provider:github:process', 'provider:gmail:process']);
    expect(invocations).toHaveLength(2);
    expect(invocations[0].settings.flowControl).toEqual({
      key: 'onboarding-understanding.writing.session-1',
      parallelism: 1,
    });
  });

  it('replays a commit-before-ack delivery with the same fingerprint child identity', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@2')) };
    const first = createContext({ ...payload, providerIds: ['github'] });
    const replay = createContext({ ...payload, providerIds: ['github'] });
    const dependencies = {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
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
  });

  it('does not invoke writing for terminal failure and lets transient errors retry', async () => {
    const terminal = createContext({ ...payload, providerIds: ['github'] });
    await processUnderstandingProviders(terminal.context as never, {
      createService: async () =>
        ({
          processProvider: vi.fn(async () => ({ ...completed('github', ''), status: 'failed' })),
        }) as never,
      processCollectedWorkflow: workflow as never,
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
      }),
    ).rejects.toBe(transient);
  });

  it('deduplicates selected providers and rejects unsafe external payload fields', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@1')) };
    const valid = createContext({ ...payload, providerIds: ['github', 'github'] });
    await processUnderstandingProviders(valid.context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
    });
    expect(service.processProvider).toHaveBeenCalledOnce();
    expect(JSON.stringify(valid.invocations)).not.toMatch(/token|accountId|markdown|xml/i);

    const unsafe = createContext({ ...payload, accessToken: 'secret', providerIds: ['github:1'] });
    await expect(
      processUnderstandingProviders(unsafe.context as never, {
        createService: vi.fn(),
        processCollectedWorkflow: workflow as never,
      }),
    ).rejects.toThrow();
  });
});

describe('failRunningUnderstandingProviders', () => {
  it('terminalizes only selected current running revisions and ignores reset races', async () => {
    const service = {
      failProvider: vi.fn(async () => ({})),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: {
          gmail: { revision: 4, status: 'failed' },
          github: { revision: 8, status: 'running' },
          slack: { revision: 3, status: 'running' },
        },
      })),
    };
    await expect(
      failRunningUnderstandingProviders(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failedProviderIds: ['github'] });
    expect(service.failProvider).toHaveBeenCalledWith({
      providerId: 'github',
      revision: 8,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    service.get.mockRejectedValueOnce(new errors.DomainError());
    await expect(
      failRunningUnderstandingProviders(payload, { createService: async () => service as never }),
    ).resolves.toEqual({ failedProviderIds: [] });
  });
});
