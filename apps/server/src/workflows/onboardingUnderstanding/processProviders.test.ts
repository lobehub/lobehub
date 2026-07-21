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
  providers: [
    { id: 'gmail', revision: 1 },
    { id: 'github', revision: 1 },
  ],
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

    expect(steps).toEqual(['provider:github:1:process', 'provider:gmail:1:process']);
    expect(service.processProvider).toHaveBeenCalledWith({
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    expect(invocations).toHaveLength(2);
    expect(invocations[0].settings.flowControl).toEqual({
      key: 'onboarding-understanding.writing.session-1',
      parallelism: 1,
    });
    expect(JSON.stringify({ invocations, payload })).not.toMatch(/token|accountId|markdown|xml/i);
  });

  it('replays a commit-before-ack delivery with the same fingerprint child identity', async () => {
    const service = { processProvider: vi.fn(async () => completed('github', 'github@2', 2)) };
    const attempt = { id: 'github', revision: 2 };
    const first = createContext({ ...payload, providers: [attempt] });
    const replay = createContext({ ...payload, providers: [attempt] });
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
});
