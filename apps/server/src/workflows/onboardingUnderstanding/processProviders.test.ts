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
  const events: string[] = [];
  const invocations: Array<{ settings: any; stepName: string }> = [];
  return {
    context: {
      invoke: async (stepName: string, settings: any) => {
        events.push(`invoke:${stepName}`);
        invocations.push({ settings, stepName });
        return { body: { accepted: true } };
      },
      requestPayload,
      run: async <T>(stepName: string, action: () => Promise<T>) => {
        events.push(`start:${stepName}`);
        const result = await action();
        events.push(`finish:${stepName}`);
        return result;
      },
    },
    events,
    invocations,
  };
};

describe('processUnderstandingProviders', () => {
  it('starts providers concurrently and invokes writing as each provider completes', async () => {
    let releaseGmail!: () => void;
    const gmailGate = new Promise<void>((resolve) => {
      releaseGmail = resolve;
    });
    const service = {
      claimProvider: vi.fn(async ({ providerId }: { providerId: string }) => ({
        claimed: true,
        providerId,
        revision: 2,
      })),
      collectProvider: vi.fn(async ({ providerId }: { providerId: string }) => {
        if (providerId === 'gmail') await gmailGate;
        return {
          failedCount: 0,
          providerId,
          revision: 2,
          sourceCount: 1,
          status: 'completed' as const,
          succeededCount: 1,
        };
      }),
    };
    const { context, events, invocations } = createContext(payload);
    const running = processUnderstandingProviders(context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
    });

    await vi.waitFor(() => {
      expect(events).toContain('start:provider:github:collect:2');
      expect(invocations).toHaveLength(1);
    });
    expect(invocations[0].stepName).toBe('provider:github:write:2');
    releaseGmail();

    await expect(running).resolves.toMatchObject({
      providers: [
        { providerId: 'github', revision: 2, status: 'completed' },
        { providerId: 'gmail', revision: 2, status: 'completed' },
      ],
    });
    expect(events.indexOf('start:provider:gmail:claim')).toBeLessThan(
      events.indexOf('finish:provider:github:claim'),
    );
    expect(events.indexOf('finish:provider:github:claim')).toBeLessThan(
      events.indexOf('start:provider:github:collect:2'),
    );
    expect(invocations).toHaveLength(2);
    expect(invocations[0].settings).toMatchObject({
      body: { sessionId: 'session-1', topicId: 'topic-1', userId: 'user-1' },
      flowControl: {
        key: 'onboarding-understanding.writing.session-1',
        parallelism: 1,
      },
      workflow,
    });
    expect(invocations[0].settings.workflowRunId).toMatch(
      /^onboarding-understanding-collected-[a-f0-9]{32}$/,
    );
  });

  it('does not collect an unclaimed provider or invoke writing after terminal failure', async () => {
    const service = {
      claimProvider: vi.fn(async ({ providerId }: { providerId: string }) =>
        providerId === 'gmail'
          ? { claimed: false, providerId, revision: 4 }
          : { claimed: true, providerId, revision: 5 },
      ),
      collectProvider: vi.fn(async () => ({
        failedCount: 1,
        providerId: 'github',
        revision: 5,
        sourceCount: 0,
        status: 'failed' as const,
        succeededCount: 0,
      })),
    };
    const { context, invocations } = createContext(payload);

    const result = await processUnderstandingProviders(context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
    });

    expect(service.collectProvider).toHaveBeenCalledOnce();
    expect(invocations).toHaveLength(0);
    expect(result.providers).toEqual([
      {
        failedCount: 1,
        providerId: 'github',
        revision: 5,
        sourceCount: 0,
        status: 'failed',
        succeededCount: 0,
      },
      { providerId: 'gmail', revision: 4, status: 'skipped' },
    ]);
  });

  it('lets transient collection errors escape and supports a selected one-provider retry', async () => {
    const transient = new Error('connector temporarily unavailable');
    const service = {
      claimProvider: vi.fn(async () => ({ claimed: true, providerId: 'github', revision: 7 })),
      collectProvider: vi.fn(async () => {
        throw transient;
      }),
    };
    const { context, invocations } = createContext({ ...payload, providerIds: ['github'] });

    await expect(
      processUnderstandingProviders(context as never, {
        createService: async () => service as never,
        processCollectedWorkflow: workflow as never,
      }),
    ).rejects.toBe(transient);
    expect(service.claimProvider).toHaveBeenCalledWith({
      providerId: 'github',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    expect(invocations).toHaveLength(0);
  });

  it('deduplicates providers and keeps durable outputs free of connector data', async () => {
    const service = {
      claimProvider: vi.fn(async () => ({ claimed: true, providerId: 'github', revision: 1 })),
      collectProvider: vi.fn(async () => ({
        failedCount: 0,
        providerId: 'github',
        revision: 1,
        sourceCount: 2,
        status: 'completed' as const,
        succeededCount: 2,
      })),
    };
    const { context, invocations } = createContext({
      ...payload,
      providerIds: ['github', 'github'],
    });

    const result = await processUnderstandingProviders(context as never, {
      createService: async () => service as never,
      processCollectedWorkflow: workflow as never,
    });

    expect(service.claimProvider).toHaveBeenCalledOnce();
    const serialized = JSON.stringify({ invocations, result });
    expect(serialized).not.toMatch(/token|accountId|markdown|xml/i);
  });

  it('rejects unsafe or ambiguous external provider payload fields', async () => {
    const { context } = createContext({
      ...payload,
      accessToken: 'secret',
      providerIds: ['github:account-1'],
    });

    await expect(
      processUnderstandingProviders(context as never, {
        createService: vi.fn(),
        processCollectedWorkflow: workflow as never,
      }),
    ).rejects.toThrow();
  });
});

describe('failRunningUnderstandingProviders', () => {
  it('terminalizes only selected providers that are still running at their current revision', async () => {
    const service = {
      failProvider: vi.fn(async () => ({})),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: {
          gmail: { revision: 4, status: 'failed' },
          github: { revision: 8, status: 'running' },
          slack: { revision: 3, status: 'running' },
        },
        status: 'processing',
      })),
    };

    await expect(
      failRunningUnderstandingProviders(payload, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ failedProviderIds: ['github'] });
    expect(service.failProvider).toHaveBeenCalledWith({
      providerId: 'github',
      revision: 8,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
  });

  it('leaves a newer session untouched', async () => {
    const service = {
      failProvider: vi.fn(),
      get: vi.fn(async () => ({
        id: 'session-new',
        sources: { github: { revision: 9, status: 'running' } },
        status: 'processing',
      })),
    };

    await expect(
      failRunningUnderstandingProviders(payload, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ failedProviderIds: [] });
    expect(service.failProvider).not.toHaveBeenCalled();
  });

  it('treats a reset or deleted onboarding topic as an already-terminal no-op', async () => {
    const service = {
      failProvider: vi.fn(),
      get: vi.fn(async () => {
        throw new errors.DomainError();
      }),
    };

    await expect(
      failRunningUnderstandingProviders(payload, {
        createService: async () => service as never,
      }),
    ).resolves.toEqual({ failedProviderIds: [] });
    expect(service.failProvider).not.toHaveBeenCalled();
  });

  it('treats a reset racing after polling as an already-terminal no-op', async () => {
    const service = {
      failProvider: vi.fn(async () => {
        throw new errors.DomainError();
      }),
      get: vi.fn(async () => ({
        id: 'session-1',
        sources: { github: { revision: 8, status: 'running' } },
        status: 'processing',
      })),
    };

    await expect(
      failRunningUnderstandingProviders(
        { ...payload, providerIds: ['github'] },
        {
          createService: async () => service as never,
        },
      ),
    ).resolves.toEqual({ failedProviderIds: [] });
  });
});
