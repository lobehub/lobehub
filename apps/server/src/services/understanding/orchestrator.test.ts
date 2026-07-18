import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingOrchestrator } from './orchestrator';
import { createUnderstandingProviderRegistry } from './providers';
import type { UnderstandingProvider } from './types';
import { UnderstandingSourceIdentificationError } from './types';

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [{ description: 'Builds agent systems.', salience: 96, title: 'Agent systems' }],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'You build agents.',
    reasoning: 'Source backed.',
    tagline: 'Builder',
  },
  profile: {
    description: 'Engineer',
    domains: ['AI'],
    name: 'Neko',
    pronoun: 'she/her',
    roles: ['engineer'],
    summary: 'Builds AI systems.',
    tagline: 'AI engineer',
  },
};

const diagnostics: CollectionDiagnostics = {
  errors: [],
  evidenceCount: 3,
  failedCount: 0,
  succeededCount: 2,
};

const emptyGmailDiagnostics: CollectionDiagnostics = {
  errors: [
    'recent',
    'receipts',
    'invoices',
    'subscriptions',
    'briefings',
    'reports',
    'credits',
    'ai',
  ].map((operation) => ({
    code: 'GMAIL_SEARCH_FAILED',
    message: 'Gmail search category failed',
    operation,
    provider: 'gmail',
    retryable: false,
  })),
  evidenceCount: 0,
  failedCount: 8,
  succeededCount: 0,
};

const provider = (id: string, brief: string, fail = false): UnderstandingProvider => ({
  collect: vi.fn(async () => {
    if (fail) throw new Error('collection failed');
    return { diagnostics, sourceBrief: brief, sourceCount: 3 };
  }),
  discoverSources: vi.fn(async () => [
    {
      candidateId: `${id}-candidate`,
      credentialOrigin: 'connector' as const,
      credentialReference: `${id}-credential`,
      provider: id,
    },
  ]),
  id,
  identifySource: vi.fn(async () => ({
    credential: { token: `${id}-secret` },
    displayName: `${id}-account`,
    externalAccountId: `${id}-user`,
    grantedScopes: [],
  })),
  originPriority: ['connector'],
  requiredScopes: [],
  resolveSource: vi.fn(async (reference, locator) => ({
    ...reference,
    ...locator,
    credential: { token: `${id}-secret` },
    grantedScopes: [],
  })),
  usefulOptionalScopes: [],
});

const createHarness = (
  failedProvider?: string,
  emptyProvider?: string,
  discoveryFailure = false,
) => {
  let sequence = 0;
  let now = new Date('2026-07-17T08:30:00.000Z');
  let session: OnboardingUnderstandingSession | undefined;
  const operations = new Map<string, { completedAt?: Date; status: string }>();
  const contents = new Map<string, string>();
  const results = new Map<string, OnboardingUnderstandingMessageMetadata>();
  const resultReadFailures = new Map<string, Error[]>();
  const afterResultPersist = new Map<string, () => void>();
  const afterResultRead = new Map<string, () => void>();
  const payloads = new Map<string, { brief: string; diagnostics: CollectionDiagnostics }>();
  const locators = new Map<string, any>();
  const sessionErrors: any[] = [];
  const scheduled: Array<() => Promise<void>> = [];
  let sessionUpdatesBeforeRejection: number | undefined;
  let sessionUpdatesBeforePostCommitRejection: number | undefined;
  let sessionUpdatesBeforeHook: number | undefined;
  let sessionUpdateHook: (() => void) | undefined;
  const sessionReadFailures: Error[] = [];
  let synchronizedSessionReads = 0;
  let releaseSynchronizedSessionReads: (() => void) | undefined;
  let synchronizedSessionReadBarrier: Promise<void> | undefined;
  const putSourcePayload = vi.fn(
    async ({ brief, diagnostics, runId }) => void payloads.set(runId, { brief, diagnostics }),
  );
  const deleteSourcePayload = vi.fn(async ({ runId }) => void payloads.delete(runId));
  const deleteSourceLocator = vi.fn(async ({ runId }) => void locators.delete(runId));
  const deleteSourceSession = vi.fn(async () => void sessionErrors.splice(0));
  const putSourceLocator = vi.fn(async ({ locator, runId }) => void locators.set(runId, locator));
  const deleteAgentOperation = vi.fn(async (_operationId: string) => undefined);
  const ensureThread = vi.fn();
  const gmailProvider = provider(
    'gmail',
    '<gmail><message>GMAIL_XML_SENTINEL</message></gmail>',
    failedProvider === 'gmail',
  );
  if (emptyProvider === 'gmail') {
    gmailProvider.collect = vi.fn(async () => ({
      diagnostics: emptyGmailDiagnostics,
      sourceBrief: '',
      sourceCount: 0,
    }));
  }
  const githubProvider = provider(
    'github',
    '# GitHub\n\nGITHUB_MARKDOWN_SENTINEL',
    failedProvider === 'github',
  );
  if (discoveryFailure) {
    gmailProvider.discoverSources = vi.fn(async () => {
      throw new Error('gmail discovery unavailable');
    });
    githubProvider.discoverSources = vi.fn(async () => {
      throw new Error('github discovery unavailable');
    });
  }
  const registry = createUnderstandingProviderRegistry([githubProvider, gmailProvider]);
  const execAgent = vi.fn(async ({ appContext }: any) => {
    const operationId = `operation-${appContext.threadId}`;
    const assistantMessageId = `message-${appContext.threadId}`;
    operations.set(operationId, { status: 'running' });
    return { agentId: 'understanding-agent', assistantMessageId, operationId, success: true };
  });
  const putSessionErrors = vi.fn(async ({ errors }) => void sessionErrors.push(...errors));
  const dependencies = {
    agent: { execAgent },
    agentId: 'understanding-agent',
    context: { userId: 'user' },
    ids: () => `id-${++sequence}`,
    messages: { readContent: async (id: string) => contents.get(id) },
    now: () => now,
    operations: { findById: async (id: string) => operations.get(id) ?? null },
    registry,
    results: {
      ensureThread,
      persist: vi.fn(async ({ metadata, operationId }) => {
        results.set(operationId, metadata);
        afterResultPersist.get(operationId)?.();
        afterResultPersist.delete(operationId);
        return metadata;
      }),
      read: vi.fn(async ({ operationId }) => {
        const failures = resultReadFailures.get(operationId);
        const failure = failures?.shift();
        if (failure) throw failure;
        const result = results.get(operationId);
        if (!result) return;
        afterResultRead.get(operationId)?.();
        afterResultRead.delete(operationId);
        return result;
      }),
    },
    runtime: { deleteAgentOperation },
    sessions: {
      claimMerge: vi.fn(async (_topicId, sessionId, threadId) => {
        if (!session || session.id !== sessionId || session.mergeRun) return false;
        if (!session.runs.every((run) => ['completed', 'failed', 'stale'].includes(run.status))) {
          return false;
        }
        const completed = session.runs.filter((run) => run.status === 'completed');
        if (completed.length === 0) return false;
        session = {
          ...session,
          mergeRun: {
            inputThreadIds: completed.map((run) => run.threadId),
            status: 'pending',
            threadId,
          },
        };
        return true;
      }),
      get: vi.fn(async () => {
        const readFailure = sessionReadFailures.shift();
        if (readFailure) throw readFailure;
        const current = session;
        if (synchronizedSessionReads > 0 && synchronizedSessionReadBarrier) {
          synchronizedSessionReads -= 1;
          if (synchronizedSessionReads === 0) releaseSynchronizedSessionReads?.();
          await synchronizedSessionReadBarrier;
        }
        return current;
      }),
      install: vi.fn(async (_topicId, value, expectedPriorSessionId) => {
        if (expectedPriorSessionId === undefined) {
          if (session) return session;
        } else {
          if (!session) throw new Error('stale');
          if (
            session.id !== expectedPriorSessionId ||
            session.runs.length !== 0 ||
            session.status !== 'failed' ||
            session.mergeRun
          ) {
            return session;
          }
        }
        session = value;
        return value;
      }),
      update: vi.fn(async (_topicId, sessionId, mutate) => {
        if (sessionUpdatesBeforeHook !== undefined) {
          if (sessionUpdatesBeforeHook === 0) {
            sessionUpdatesBeforeHook = undefined;
            sessionUpdateHook?.();
            sessionUpdateHook = undefined;
          } else {
            sessionUpdatesBeforeHook -= 1;
          }
        }
        if (sessionUpdatesBeforeRejection !== undefined) {
          if (sessionUpdatesBeforeRejection === 0) {
            sessionUpdatesBeforeRejection = undefined;
            throw new Error('injected session update failure');
          }
          sessionUpdatesBeforeRejection -= 1;
        }
        const current = session;
        if (!current || current.id !== sessionId) throw new Error('stale');
        const updated = mutate(current);
        session = updated;
        if (sessionUpdatesBeforePostCommitRejection !== undefined) {
          if (sessionUpdatesBeforePostCommitRejection === 0) {
            sessionUpdatesBeforePostCommitRejection = undefined;
            throw new Error('injected post-commit session update failure');
          }
          sessionUpdatesBeforePostCommitRejection -= 1;
        }
        return updated;
      }),
    },
    sourceStore: {
      deleteSession: deleteSourceSession,
      deleteSourceLocator,
      deleteSourcePayload,
      get: vi.fn(async ({ runId }) => payloads.get(runId) ?? null),
      getSessionErrors: vi.fn(async () => sessionErrors),
      getSourceLocator: vi.fn(async ({ runId }) => locators.get(runId) ?? null),
      put: putSourcePayload,
      putSessionErrors,
      putSourceLocator,
    },
    topic: { assertActiveOnboardingTopic: vi.fn() },
  };
  const orchestrator = new UnderstandingOrchestrator(dependencies);

  const complete = (
    run: { assistantMessageId?: string; operationId?: string },
    output = analysis,
    completedAt = new Date(),
  ) => {
    if (!run.operationId || !run.assistantMessageId) throw new Error('run not launched');
    operations.set(run.operationId, { completedAt, status: 'done' });
    contents.set(run.assistantMessageId, JSON.stringify(output));
  };

  return {
    afterResultPersist: (operationId: string, callback: () => void) => {
      afterResultPersist.set(operationId, callback);
    },
    afterResultRead: (operationId: string, callback: () => void) => {
      afterResultRead.set(operationId, callback);
    },
    beforeSessionUpdateAfter: (successfulUpdates: number, callback: () => void) => {
      sessionUpdatesBeforeHook = successfulUpdates;
      sessionUpdateHook = callback;
    },
    complete,
    deleteAgentOperation,
    deleteSourceSession,
    deleteSourceLocator,
    dependencies,
    deleteSourcePayload,
    ensureThread,
    execAgent,
    failSessionUpdateAfter: (successfulUpdates = 0) => {
      sessionUpdatesBeforeRejection = successfulUpdates;
    },
    failSessionUpdateAfterCommit: (successfulUpdates = 0) => {
      sessionUpdatesBeforePostCommitRejection = successfulUpdates;
    },
    failResultRead: (operationId: string, error: Error) => {
      const failures = resultReadFailures.get(operationId) ?? [];
      failures.push(error);
      resultReadFailures.set(operationId, failures);
    },
    failSessionRead: (error = new Error('injected session read failure')) => {
      sessionReadFailures.push(error);
    },
    getSession: () => session!,
    gmailProvider,
    githubProvider,
    operations,
    orchestrator,
    putSourcePayload,
    putSourceLocator,
    putSessionErrors,
    putResult: (operationId: string, result: OnboardingUnderstandingMessageMetadata) => {
      results.set(operationId, result);
    },
    schedule: (task: () => Promise<void>) => void scheduled.push(task),
    scheduled,
    sessionErrors,
    setMergeRun: (mergeRun: OnboardingUnderstandingSession['mergeRun']) => {
      if (!session) throw new Error('session not installed');
      session = { ...session, mergeRun };
    },
    setSession: (next: OnboardingUnderstandingSession) => {
      session = next;
    },
    setNow: (value: Date) => {
      now = value;
    },
    updateRun: (
      threadId: string,
      mutate: (
        run: OnboardingUnderstandingSession['runs'][number],
      ) => OnboardingUnderstandingSession['runs'][number],
    ) => {
      if (!session) throw new Error('session not installed');
      session = {
        ...session,
        runs: session.runs.map((run) => (run.threadId === threadId ? mutate(run) : run)),
      };
    },
    synchronizeNextSessionReads: (count: number) => {
      synchronizedSessionReads = count;
      synchronizedSessionReadBarrier = new Promise<void>((resolve) => {
        releaseSynchronizedSessionReads = resolve;
      });
    },
  };
};

describe('UnderstandingOrchestrator', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('collects GitHub Markdown and Gmail XML through ordinary agent operations', async () => {
    const started = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    expect(started.runs).toHaveLength(2);

    await harness.scheduled[0]();

    expect(harness.execAgent).toHaveBeenCalledTimes(2);
    const inputs = harness.execAgent.mock.calls.map(([input]) => input);
    expect(
      inputs.some(({ ephemeralUserMessage }) =>
        ephemeralUserMessage.includes('GITHUB_MARKDOWN_SENTINEL'),
      ),
    ).toBe(true);
    expect(
      inputs.some(({ ephemeralUserMessage }) =>
        ephemeralUserMessage.includes('GMAIL_XML_SENTINEL'),
      ),
    ).toBe(true);
    for (const input of inputs) {
      expect(input).toMatchObject({
        autoStart: true,
        maxSteps: 1,
        slug: 'onboarding-understanding',
        suppressUserMessage: true,
        trigger: 'onboarding',
      });
      expect(input).not.toHaveProperty('operationId');
      expect(input).not.toHaveProperty('assistantMessageId');
      expect(input).not.toHaveProperty('preclaimedOperation');
      expect(input).not.toHaveProperty('persistencePolicy');
      expect(input).not.toHaveProperty('reasoningGraph');
    }
  });

  it('returns and resumes an existing referenced session without rediscovery or locator writes', async () => {
    const first = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const discoveryCount = vi.mocked(harness.githubProvider.discoverSources).mock.calls.length;
    const locatorWriteCount = harness.putSourceLocator.mock.calls.length;
    harness.setSession({
      ...harness.getSession(),
      mergeRun: {
        inputThreadIds: [],
        status: 'failed',
        threadId: 'existing-merge-thread',
      },
    });

    const repeated = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);

    expect(repeated.id).toBe(first.id);
    expect(repeated.runs).toEqual(first.runs);
    expect(repeated.mergeRun).toMatchObject({ threadId: 'existing-merge-thread' });
    expect(vi.mocked(harness.githubProvider.discoverSources)).toHaveBeenCalledTimes(discoveryCount);
    expect(harness.putSourceLocator).toHaveBeenCalledTimes(locatorWriteCount);
  });

  it('converges concurrent starts on one session without loser locator writes', async () => {
    const [left, right] = await Promise.all([
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
    ]);

    expect(left.id).toBe(right.id);
    expect(harness.putSourceLocator).toHaveBeenCalledTimes(2);
    expect(harness.getSession().id).toBe(left.id);
  });

  it('fences loser resume while the winning start is initializing source locators', async () => {
    let releaseLocatorWrites!: () => void;
    const locatorWriteGate = new Promise<void>((resolve) => {
      releaseLocatorWrites = resolve;
    });
    const writeLocator = harness.putSourceLocator.getMockImplementation();
    if (!writeLocator) throw new Error('locator writer is unavailable');
    harness.putSourceLocator.mockImplementation(async (input) => {
      await locatorWriteGate;
      await writeLocator(input);
    });

    const winner = harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await vi.waitFor(() => expect(harness.putSourceLocator).toHaveBeenCalledTimes(2));
    const loser = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    expect(loser.id).toBe(harness.getSession().id);
    expect(harness.scheduled).toHaveLength(1);

    await harness.scheduled[0]();
    expect(harness.getSession().runs.every(({ status }) => status === 'pending')).toBe(true);

    releaseLocatorWrites();
    await winner;
    expect(harness.getSession().initializedAt).toBe('2026-07-17T08:30:00.000Z');
    expect(harness.scheduled).toHaveLength(2);
    await harness.scheduled[1]();
    expect(harness.getSession().runs.every(({ status }) => status === 'analyzing')).toBe(true);
  });

  it('converges concurrent initial zero-source starts with one discovery error write', async () => {
    harness = createHarness(undefined, undefined, true);
    harness.synchronizeNextSessionReads(2);

    const [left, right] = await Promise.all([
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
    ]);

    expect(left.id).toBe(right.id);
    expect(harness.getSession()).toMatchObject({ id: left.id, runs: [], status: 'failed' });
    expect(harness.putSessionErrors).toHaveBeenCalledTimes(1);
    expect(harness.putSessionErrors).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: left.id }),
    );
    expect(harness.deleteSourceSession).not.toHaveBeenCalled();
  });

  it('replaces only a zero-run failed session and deletes its temporary state', async () => {
    harness.setSession({ id: 'empty-failed-session', runs: [], status: 'failed' });

    const started = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);

    expect(started.id).not.toBe('empty-failed-session');
    expect(harness.getSession().runs).toHaveLength(2);
    expect(harness.deleteSourceSession).toHaveBeenCalledWith({
      sessionId: 'empty-failed-session',
      userId: 'user',
    });
  });

  it('converges concurrent zero-source replacements and tombstones only the observed prior', async () => {
    harness = createHarness(undefined, undefined, true);
    harness.setSession({ id: 'empty-failed-session', runs: [], status: 'failed' });
    harness.synchronizeNextSessionReads(2);

    const [left, right] = await Promise.all([
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
      harness.orchestrator.start({ topicId: 'topic' }, harness.schedule),
    ]);

    expect(left.id).toBe(right.id);
    expect(harness.getSession()).toMatchObject({ id: left.id, runs: [], status: 'failed' });
    expect(harness.deleteSourceSession).toHaveBeenCalledTimes(1);
    expect(harness.deleteSourceSession).toHaveBeenCalledWith({
      sessionId: 'empty-failed-session',
      userId: 'user',
    });
    expect(harness.putSessionErrors).toHaveBeenCalledTimes(1);
    expect(harness.putSessionErrors).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: left.id }),
    );
  });

  it('deletes source runtime state after terminal reconciliation', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    harness.complete(run);

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs[0]).toMatchObject({ result: { kind: 'source' }, status: 'completed' });
    expect(harness.deleteAgentOperation).toHaveBeenCalledWith(run.operationId);
  });

  it('does not repeat source runtime cleanup on later polls', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    harness.complete(run);

    await harness.orchestrator.getSession({ topicId: 'topic' });
    await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === run.operationId,
      ),
    ).toHaveLength(1);
  });

  it('deletes merge runtime state after terminal reconciliation', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    if (!session.mergeRun) throw new Error('merge not launched');
    harness.deleteAgentOperation.mockClear();
    harness.complete(session.mergeRun);

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toMatchObject({ result: { kind: 'merged' }, status: 'completed' });
    expect(harness.deleteAgentOperation).toHaveBeenCalledWith(session.mergeRun.operationId);
  });

  it('does not repeat merge runtime cleanup on later polls', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    if (!session.mergeRun) throw new Error('merge not launched');
    harness.complete(session.mergeRun);

    await harness.orchestrator.getSession({ topicId: 'topic' });
    await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === session.mergeRun?.operationId,
      ),
    ).toHaveLength(1);
  });

  it('keeps successful analysis when runtime cleanup fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    harness.complete(run);
    harness.deleteAgentOperation.mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs[0]).toMatchObject({ result: { kind: 'source' }, status: 'completed' });
    expect(result.displayResult).toMatchObject({ kind: 'provisional' });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'AGENT_OPERATION_CLEANUP_FAILED',
        provider: 'github',
        retryable: true,
      }),
    );
  });

  it('retries source cleanup after failure and marks it complete only after success', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    harness.complete(run);
    harness.deleteAgentOperation.mockRejectedValueOnce(new Error('redis unavailable'));

    const failedCleanup = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(failedCleanup.runs[0]).not.toHaveProperty('cleanupStatus');
    expect(failedCleanup.warnings).toContainEqual(
      expect.objectContaining({ code: 'AGENT_OPERATION_CLEANUP_FAILED' }),
    );

    const recovered = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(recovered.runs[0]).toMatchObject({ cleanupStatus: 'completed' });
    expect(harness.deleteSourcePayload).toHaveBeenCalledTimes(2);
    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === run.operationId,
      ),
    ).toHaveLength(2);

    await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(harness.deleteSourcePayload).toHaveBeenCalledTimes(2);
    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === run.operationId,
      ),
    ).toHaveLength(2);
  });

  it('retries merge cleanup after failure and marks it complete only after success', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    if (!session.mergeRun) throw new Error('merge not launched');
    harness.complete(session.mergeRun);
    harness.deleteAgentOperation.mockRejectedValueOnce(new Error('redis unavailable'));

    const failedCleanup = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(failedCleanup.mergeRun).not.toHaveProperty('cleanupStatus');
    expect(failedCleanup.warnings).toContainEqual(
      expect.objectContaining({ code: 'AGENT_OPERATION_CLEANUP_FAILED' }),
    );

    const recovered = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(recovered.mergeRun).toMatchObject({ cleanupStatus: 'completed' });
    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === session.mergeRun?.operationId,
      ),
    ).toHaveLength(2);

    await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(
      harness.deleteAgentOperation.mock.calls.filter(
        ([operationId]) => operationId === session.mergeRun?.operationId,
      ),
    ).toHaveLength(2);
  });

  it('warns when persisted source result recovery cannot delete its raw payload', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    if (!run.operationId) throw new Error('run not launched');
    harness.putResult(run.operationId, {
      analysis,
      diagnostics,
      kind: 'source',
      resultId: `result-${run.operationId}`,
      source: run.source,
    });
    harness.deleteSourcePayload.mockRejectedValueOnce(new Error('redis unavailable'));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs[0]).toMatchObject({ result: { kind: 'source' }, status: 'completed' });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_CLEANUP_FAILED',
        provider: 'github',
        retryable: true,
      }),
    );
    expect(harness.deleteAgentOperation).toHaveBeenCalledWith(run.operationId);
  });

  it('returns public source accounts immediately without collection payloads or credentials', async () => {
    const started = await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);

    expect(started).toMatchObject({
      id: 'id-1',
      runs: [
        {
          source: {
            displayName: 'github-account',
            externalAccountId: 'github-user',
            provider: 'github',
          },
          status: 'pending',
        },
        {
          source: {
            displayName: 'gmail-account',
            externalAccountId: 'gmail-user',
            provider: 'gmail',
          },
          status: 'pending',
        },
      ],
      status: 'pending',
    });
    expect(JSON.stringify(started)).not.toMatch(
      /candidateId|credential|GITHUB_MARKDOWN_SENTINEL|GMAIL_XML_SENTINEL|sourceBrief|token/,
    );
  });

  it('returns the first source result, then replaces it with the merged result', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);

    const provisional = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(provisional.displayResult?.kind).toBe('provisional');
    expect(provisional.mergeRun).toBeUndefined();

    session = harness.getSession();
    harness.complete(session.runs[1]);
    const merging = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(merging.displayResult?.kind).toBe('provisional');
    expect(merging.mergeRun?.status).toBe('processing');
    expect(harness.execAgent).toHaveBeenCalledTimes(3);

    session = harness.getSession();
    harness.complete(session.mergeRun!);
    const merged = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(merged.displayResult?.kind).toBe('merged');
    expect(merged.status).toBe('completed');
  });

  it('keeps the first completed provisional result across polls and orchestrator reconstruction', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0], analysis, new Date('2026-07-17T08:31:00.000Z'));
    harness.complete(session.runs[1], analysis, new Date('2026-07-17T08:30:00.000Z'));

    const firstPoll = await harness.orchestrator.getSession({ topicId: 'topic' });
    const secondPoll = await harness.orchestrator.getSession({ topicId: 'topic' });
    const reconstructedPoll = await new UnderstandingOrchestrator(harness.dependencies).getSession({
      topicId: 'topic',
    });

    expect(firstPoll.displayResult).toMatchObject({
      kind: 'provisional',
      result: { source: { provider: 'gmail' } },
    });
    expect(secondPoll.displayResult).toMatchObject({
      kind: 'provisional',
      result: { source: { provider: 'gmail' } },
    });
    expect(reconstructedPoll.displayResult).toMatchObject({
      kind: 'provisional',
      result: { source: { provider: 'gmail' } },
    });
    expect(harness.getSession().runs.map(({ completedAt }) => completedAt)).toEqual([
      '2026-07-17T08:31:00.000Z',
      '2026-07-17T08:30:00.000Z',
    ]);
  });

  it('preserves the only explicit source pronoun when the merge omits it', async () => {
    const singleSourceHarness = createHarness('gmail');
    await singleSourceHarness.orchestrator.start(
      { topicId: 'topic' },
      singleSourceHarness.schedule,
    );
    await singleSourceHarness.scheduled[0]();

    let session = singleSourceHarness.getSession();
    singleSourceHarness.complete(session.runs[0]);
    const merging = await singleSourceHarness.orchestrator.getSession({ topicId: 'topic' });
    expect(merging.mergeRun?.status).toBe('processing');

    session = singleSourceHarness.getSession();
    singleSourceHarness.complete(session.mergeRun!, {
      ...analysis,
      profile: { ...analysis.profile, pronoun: 'non-specific' },
    });
    const merged = await singleSourceHarness.orchestrator.getSession({ topicId: 'topic' });

    expect(merged.mergeRun?.result?.analysis?.profile.pronoun).toBe('she/her');
  });

  it('uses non-specific when successful sources have conflicting explicit pronouns', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();

    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1], {
      ...analysis,
      profile: { ...analysis.profile, pronoun: 'they/them' },
    });
    const merging = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(merging.mergeRun?.status).toBe('processing');

    session = harness.getSession();
    harness.complete(session.mergeRun!);
    const merged = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(merged.mergeRun?.result?.analysis?.profile.pronoun).toBe('non-specific');
  });

  it('marks malformed agent output as a retryable source failure', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    if (!run.operationId || !run.assistantMessageId) throw new Error('run not launched');
    harness.operations.set(run.operationId, { status: 'done' });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(result.runs[0].status).toBe('failed');
    expect(result.runs[0].result?.kind).toBe('source_error');
    expect(result.runs[0].diagnostics).toEqual({
      evidenceCount: 3,
      failedCount: 1,
      succeededCount: 2,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_ANALYSIS_OUTPUT_INVALID',
        provider: 'github',
        retryable: false,
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /credential|GITHUB_MARKDOWN_SENTINEL|GMAIL_XML_SENTINEL|sourceBrief|token/,
    );
  });

  it('turns a rejected source agent launch into a safe retryable analysis failure', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockRejectedValueOnce(
      new Error('RAW_SOURCE_AGENT_REJECTION secret-token GITHUB_MARKDOWN_SENTINEL'),
    );

    await harness.scheduled[0]();
    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    const githubRun = result.runs.find(({ source }) => source.provider === 'github');

    expect(githubRun).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 1, succeededCount: 2 },
      status: 'failed',
    });
    expect(githubRun).not.toHaveProperty('assistantMessageId');
    expect(githubRun).not.toHaveProperty('operationId');
    expect(githubRun).not.toHaveProperty('result');
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_ANALYSIS_FAILED',
        provider: 'github',
        retryable: true,
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /RAW_SOURCE_AGENT_REJECTION|GITHUB_MARKDOWN_SENTINEL|secret-token/,
    );
  });

  it('uses analysis-failure diagnostics in the run summary when source launch returns failure', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockResolvedValueOnce({
      agentId: 'understanding-agent',
      assistantMessageId: 'message-source-failed',
      operationId: 'operation-source-failed',
      success: false,
    });

    await harness.scheduled[0]();
    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    const githubRun = result.runs.find(({ source }) => source.provider === 'github');

    expect(githubRun).toMatchObject({
      assistantMessageId: 'message-source-failed',
      diagnostics: { evidenceCount: 3, failedCount: 1, succeededCount: 2 },
      operationId: 'operation-source-failed',
      result: {
        diagnostics: {
          errors: [expect.objectContaining({ code: 'SOURCE_ANALYSIS_FAILED' })],
          failedCount: 1,
        },
        kind: 'source_error',
      },
      status: 'failed',
    });
  });

  it('does not mislabel source payload storage failures as analysis failures', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.putSourcePayload.mockRejectedValueOnce(
      new Error('SOURCE_STORE_WRITE_REJECTION secret-token'),
    );

    await harness.scheduled[0]();
    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    const githubRun = result.runs.find(({ source }) => source.provider === 'github');

    expect(githubRun).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 0, succeededCount: 2 },
      status: 'failed',
    });
    expect(githubRun?.result).toBeUndefined();
    expect(result.errors ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'SOURCE_ANALYSIS_FAILED' }),
    );
    expect(JSON.stringify(result)).not.toContain('SOURCE_STORE_WRITE_REJECTION');
  });

  it('repairs a source manifest after result persistence wins a partial commit', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.failSessionUpdateAfter();

    const partial = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(partial.mergeRun).toBeUndefined();
    expect(partial.runs[0]).toMatchObject({ result: { kind: 'source' }, status: 'analyzing' });

    const repaired = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(repaired.runs[0]).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 0, succeededCount: 2 },
      result: { kind: 'source' },
      status: 'completed',
    });
    expect(repaired.mergeRun?.status).toBe('processing');
  });

  it('repairs a persisted source error after its manifest update fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const run = harness.getSession().runs[0];
    if (!run.operationId) throw new Error('run not launched');
    harness.operations.set(run.operationId, { status: 'done' });
    harness.failSessionUpdateAfter();

    const partial = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(partial.runs[0]).toMatchObject({
      result: { kind: 'source_error' },
      status: 'analyzing',
    });

    const repaired = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(repaired.runs[0]).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 1, succeededCount: 2 },
      result: { kind: 'source_error' },
      status: 'failed',
    });
  });

  it('does not launch a stale pending merge after it is replaced before claim', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    const replacement = {
      inputThreadIds: session.runs.map(({ threadId }) => threadId),
      status: 'pending' as const,
      threadId: 'thread-replacement-merge',
    };
    const ensureThreadCount = harness.ensureThread.mock.calls.length;
    const execAgentCount = harness.execAgent.mock.calls.length;
    harness.beforeSessionUpdateAfter(2, () => harness.setMergeRun(replacement));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(replacement);
    expect(harness.ensureThread).toHaveBeenCalledTimes(ensureThreadCount);
    expect(harness.execAgent).toHaveBeenCalledTimes(execAgentCount);
  });

  it('cleans up a merge operation when a replacement merge wins after launch', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    const replacement = {
      inputThreadIds: session.runs.map(({ threadId }) => threadId),
      status: 'pending' as const,
      threadId: 'thread-replacement-merge',
    };
    harness.execAgent.mockImplementationOnce(async () => {
      harness.setMergeRun(replacement);
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-unadopted-merge',
        operationId: 'operation-unadopted-merge',
        success: true,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(replacement);
    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-unadopted-merge');
  });

  it('leaves a pending merge unchanged when a source result read fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    const firstRun = session.runs[0];
    if (!firstRun.operationId) throw new Error('source not launched');
    const pending = {
      inputThreadIds: session.runs.map(({ threadId }) => threadId),
      status: 'pending' as const,
      threadId: 'thread-pending-merge',
    };
    harness.setMergeRun(pending);
    harness.afterResultRead(firstRun.operationId, () =>
      harness.failResultRead(
        firstRun.operationId!,
        new Error('source result database unavailable'),
      ),
    );
    const ensureThreadCount = harness.ensureThread.mock.calls.length;
    const execAgentCount = harness.execAgent.mock.calls.length;

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(pending);
    expect(harness.ensureThread).toHaveBeenCalledTimes(ensureThreadCount);
    expect(harness.execAgent).toHaveBeenCalledTimes(execAgentCount);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'RESULT_READ_FAILED', provider: 'github', retryable: true }),
    );
  });

  it('leaves a processing merge unchanged when its result read fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    const merge = session.mergeRun;
    if (!merge?.operationId) throw new Error('merge not launched');
    harness.failResultRead(merge.operationId, new Error('merge result database unavailable'));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(merge);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'RESULT_READ_FAILED',
        provider: 'understanding',
        retryable: true,
      }),
    );
  });

  it('keeps merge failures pollable as structured safe errors', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    session = harness.getSession();
    if (!session.mergeRun?.operationId) throw new Error('merge not launched');
    harness.operations.set(session.mergeRun.operationId, { status: 'error' });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result).toMatchObject({
      displayResult: { kind: 'provisional' },
      mergeRun: {
        diagnostics: { evidenceCount: 6, failedCount: 1, succeededCount: 4 },
        result: { kind: 'merge_error' },
        status: 'failed',
      },
      status: 'failed',
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'MERGE_ANALYSIS_FAILED',
        provider: 'understanding',
        retryable: true,
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /credential|GITHUB_MARKDOWN_SENTINEL|GMAIL_XML_SENTINEL|sourceBrief|token/,
    );
  });

  it('persists a structured merge error when the merge agent cannot launch', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockResolvedValueOnce({
      agentId: 'understanding-agent',
      assistantMessageId: 'message-merge-failed',
      operationId: 'operation-merge-failed',
      success: false,
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result).toMatchObject({
      displayResult: { kind: 'provisional' },
      errors: [
        expect.objectContaining({
          code: 'MERGE_ANALYSIS_FAILED',
          provider: 'understanding',
          retryable: true,
        }),
      ],
      mergeRun: {
        result: { kind: 'merge_error' },
        status: 'failed',
      },
      status: 'failed',
    });
  });

  it('falls back to a structured merge error when the failed launch manifest update rejects', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-unadopted-merge-failure',
        operationId: 'operation-unadopted-merge-failure',
        success: false,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-unadopted-merge-failure');
    expect(result.mergeRun).toMatchObject({
      result: { kind: 'merge_error' },
      status: 'failed',
    });
    expect(result.mergeRun?.operationId).not.toBe('operation-unadopted-merge-failure');
    expect(result.mergeRun?.assistantMessageId).not.toBe('message-unadopted-merge-failure');
  });

  it('retains a durably adopted failed merge launch when its manifest update rejects afterward', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfterCommit();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-adopted-merge-failure',
        operationId: 'operation-adopted-merge-failure',
        success: false,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toMatchObject({
      assistantMessageId: 'message-adopted-merge-failure',
      operationId: 'operation-adopted-merge-failure',
      result: { kind: 'merge_error' },
      status: 'failed',
    });
  });

  it('keeps a successful merge launch processing when manifest reconciliation is inconclusive', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockImplementationOnce(async () => {
      vi.mocked(harness.dependencies.sessions.update)
        .mockRejectedValueOnce(new Error('first injected manifest update failure'))
        .mockRejectedValueOnce(new Error('second injected manifest update failure'));
      harness.failSessionRead();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-inconclusive-successful-merge',
        operationId: 'operation-inconclusive-successful-merge',
        success: true,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toMatchObject({
      assistantMessageId: 'message-inconclusive-successful-merge',
      operationId: 'operation-inconclusive-successful-merge',
      status: 'processing',
    });
    expect(result.mergeRun?.result).toBeUndefined();
  });

  it('leaves a released successful merge recoverable without fabricated references', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-released-successful-merge',
        operationId: 'operation-released-successful-merge',
        success: true,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(harness.deleteAgentOperation).toHaveBeenCalledWith(
      'operation-released-successful-merge',
    );
    expect(result.mergeRun).toMatchObject({ status: 'processing' });
    expect(result.mergeRun).not.toHaveProperty('assistantMessageId');
    expect(result.mergeRun).not.toHaveProperty('operationId');
    expect(result.mergeRun?.result).toBeUndefined();
  });

  it('removes a committed merge reference after final adoption cleanup', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockImplementationOnce(async () => {
      const update = vi.mocked(harness.dependencies.sessions.update);
      const updateSession = update.getMockImplementation()!;
      harness.failSessionUpdateAfterCommit();
      update
        .mockImplementationOnce(updateSession)
        .mockRejectedValueOnce(new Error('second manifest update failure'))
        .mockRejectedValueOnce(new Error('third manifest update failure'));
      harness.failSessionRead();
      harness.failSessionRead();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-cleaned-committed-merge',
        operationId: 'operation-cleaned-committed-merge',
        success: true,
      };
    });

    const released = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(harness.deleteAgentOperation).toHaveBeenLastCalledWith(
      'operation-cleaned-committed-merge',
    );
    expect(released.mergeRun).toMatchObject({ status: 'processing' });
    expect(released.mergeRun).not.toHaveProperty('assistantMessageId');
    expect(released.mergeRun).not.toHaveProperty('operationId');

    const recovered = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(recovered.mergeRun).toMatchObject({
      assistantMessageId: expect.any(String),
      operationId: expect.any(String),
      status: 'processing',
    });
    expect(recovered.mergeRun?.operationId).not.toBe('operation-cleaned-committed-merge');
  });

  it('recovers a processing merge without operation references on a later poll', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.setMergeRun({
      inputThreadIds: session.runs.map(({ threadId }) => threadId),
      status: 'processing',
      threadId: 'thread-interrupted-merge-launch',
    });
    harness.execAgent.mockResolvedValueOnce({
      agentId: 'understanding-agent',
      assistantMessageId: 'message-recovered-merge',
      operationId: 'operation-recovered-merge',
      success: true,
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toMatchObject({
      assistantMessageId: 'message-recovered-merge',
      operationId: 'operation-recovered-merge',
      status: 'processing',
      threadId: 'thread-interrupted-merge-launch',
    });
  });

  it('adopts the real failed merge reference when manifest reconciliation is inconclusive', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    let operationReferenceAtCleanup: string | undefined;
    harness.deleteAgentOperation.mockImplementation(async (operationId) => {
      if (operationId === 'operation-inconclusive-merge-failure') {
        operationReferenceAtCleanup = harness.getSession().mergeRun?.operationId;
      }
    });
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-inconclusive-merge-failure',
        operationId: 'operation-inconclusive-merge-failure',
        success: false,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(operationReferenceAtCleanup).toBe('operation-inconclusive-merge-failure');
    expect(result.mergeRun).toMatchObject({
      assistantMessageId: 'message-inconclusive-merge-failure',
      operationId: 'operation-inconclusive-merge-failure',
      result: { kind: 'merge_error' },
      status: 'failed',
    });
  });

  it('adopts the real failed merge reference when its first cleanup attempt fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    let cleanupAttempts = 0;
    harness.deleteAgentOperation.mockImplementation(async (operationId) => {
      if (operationId === 'operation-cleanup-failed-merge' && cleanupAttempts++ === 0) {
        throw new Error('injected cleanup failure');
      }
    });
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-cleanup-failed-merge',
        operationId: 'operation-cleanup-failed-merge',
        success: false,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(cleanupAttempts).toBeGreaterThanOrEqual(2);
    expect(result.mergeRun).toMatchObject({
      assistantMessageId: 'message-cleanup-failed-merge',
      operationId: 'operation-cleanup-failed-merge',
      result: { kind: 'merge_error' },
      status: 'failed',
    });
  });

  it('does not replace a newer merge with a failed stale launch', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    const replacement = {
      inputThreadIds: session.runs.map(({ threadId }) => threadId),
      status: 'pending' as const,
      threadId: 'thread-replacement-after-failed-launch',
    };
    harness.execAgent.mockImplementationOnce(async () => {
      harness.setMergeRun(replacement);
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-stale-merge-failure',
        operationId: 'operation-stale-merge-failure',
        success: false,
      };
    });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(replacement);
    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-stale-merge-failure');
  });

  it('persists a structured merge error when the merge agent rejects', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.execAgent.mockRejectedValueOnce(
      new Error('RAW_MERGE_AGENT_REJECTION secret-token GMAIL_XML_SENTINEL'),
    );

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result).toMatchObject({
      errors: [expect.objectContaining({ code: 'MERGE_ANALYSIS_FAILED', retryable: true })],
      mergeRun: {
        diagnostics: { evidenceCount: 6, failedCount: 1, succeededCount: 4 },
        result: { kind: 'merge_error' },
        status: 'failed',
      },
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /RAW_MERGE_AGENT_REJECTION|GMAIL_XML_SENTINEL|secret-token/,
    );
  });

  it('persists a structured merge error when pre-launch thread setup fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    harness.ensureThread.mockRejectedValueOnce(new Error('RAW_ENSURE_THREAD_FAILURE secret-token'));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result).toMatchObject({
      errors: [expect.objectContaining({ code: 'MERGE_ANALYSIS_FAILED', retryable: true })],
      mergeRun: {
        diagnostics: { evidenceCount: 6, failedCount: 1, succeededCount: 4 },
        result: { kind: 'merge_error' },
        status: 'failed',
      },
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('RAW_ENSURE_THREAD_FAILURE');
  });

  it('repairs a merge manifest after result persistence wins a partial commit', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    harness.complete(session.mergeRun!);
    harness.failSessionUpdateAfter(2);

    const partial = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(partial.mergeRun).toMatchObject({ result: { kind: 'merged' }, status: 'processing' });

    const repaired = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(repaired).toMatchObject({
      displayResult: { kind: 'merged' },
      mergeRun: {
        diagnostics: { evidenceCount: 6, failedCount: 0, succeededCount: 4 },
        result: { kind: 'merged' },
        status: 'completed',
      },
      status: 'completed',
    });
  });

  it('does not apply an existing old merge result to a replacement merge', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    const oldMerge = session.mergeRun;
    if (!oldMerge?.operationId) throw new Error('merge not launched');
    harness.putResult(oldMerge.operationId, {
      analysis,
      diagnostics: {
        errors: [],
        evidenceCount: 6,
        failedCount: 0,
        succeededCount: 4,
      },
      inputThreadIds: oldMerge.inputThreadIds,
      kind: 'merged',
      resultId: 'result-old-merge',
    });
    const replacement = {
      assistantMessageId: 'message-new-merge',
      diagnostics: { evidenceCount: 9, failedCount: 2, succeededCount: 7 },
      inputThreadIds: oldMerge.inputThreadIds,
      operationId: 'operation-new-merge',
      resultId: 'result-new-merge',
      status: 'processing' as const,
      threadId: 'thread-new-merge',
    };
    harness.afterResultRead(oldMerge.operationId, () => harness.setMergeRun(replacement));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(replacement);
    expect(JSON.stringify(result.mergeRun)).not.toContain('result-old-merge');
  });

  it('does not apply a freshly persisted old merge result to a replacement merge', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    const oldMerge = session.mergeRun;
    if (!oldMerge?.operationId) throw new Error('merge not launched');
    harness.complete(oldMerge);
    const replacement = {
      assistantMessageId: 'message-new-merge',
      diagnostics: { evidenceCount: 9, failedCount: 2, succeededCount: 7 },
      inputThreadIds: oldMerge.inputThreadIds,
      operationId: 'operation-new-merge',
      resultId: 'result-new-merge',
      status: 'processing' as const,
      threadId: 'thread-new-merge',
    };
    harness.afterResultPersist(oldMerge.operationId, () => harness.setMergeRun(replacement));

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toEqual(replacement);
    expect(JSON.stringify(result.mergeRun)).not.toContain(`result-${oldMerge.operationId}`);
  });

  it('copies malformed merge result diagnostics into the terminal summary', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    harness.complete(session.mergeRun!, {} as UnderstandingAnalysis);

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.mergeRun).toMatchObject({
      diagnostics: { evidenceCount: 6, failedCount: 1, succeededCount: 4 },
      result: {
        diagnostics: {
          errors: [expect.objectContaining({ code: 'MERGE_ANALYSIS_OUTPUT_INVALID' })],
          failedCount: 1,
        },
        kind: 'merge_error',
      },
      status: 'failed',
    });
  });

  it('keeps merge errors ahead of the global collection error cap', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    harness.complete(session.runs[0]);
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    if (!session.mergeRun?.operationId) throw new Error('merge not launched');
    harness.operations.set(session.mergeRun.operationId, { status: 'error' });
    harness.sessionErrors.push(
      ...Array.from({ length: 16 }, (_, index) => ({
        code: `SESSION_ERROR_${index}`,
        message: 'safe session error',
        operation: 'discovery',
        provider: 'understanding',
        retryable: true,
      })),
    );

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.errors).toHaveLength(16);
    expect(result.errors?.[0]).toMatchObject({ code: 'MERGE_ANALYSIS_FAILED' });
  });

  it('returns collection errors when failure happens before an agent message exists', async () => {
    harness = createHarness('github');
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs.find(({ source }) => source.provider === 'github')).toMatchObject({
      diagnostics: { failedCount: 1, succeededCount: 0 },
      status: 'failed',
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'SOURCE_COLLECTION_FAILED', provider: 'github' }),
    ]);
  });

  it('preserves provider diagnostics when empty collection fails before analysis', async () => {
    harness = createHarness(undefined, 'gmail');
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    const gmailErrors = (result.errors ?? []).filter(({ code }) => code === 'GMAIL_SEARCH_FAILED');

    expect(result.runs.find(({ source }) => source.provider === 'gmail')).toMatchObject({
      diagnostics: { evidenceCount: 0, failedCount: 8, succeededCount: 0 },
      status: 'failed',
    });
    expect(gmailErrors).toHaveLength(8);
    expect(gmailErrors.every(({ operation }) => operation === 'search')).toBe(true);
    expect(gmailErrors.every(({ retryable }) => retryable === false)).toBe(true);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_COLLECTION_EMPTY', provider: 'gmail' }),
    );
  });

  it('re-resolves and relaunches a failed source without rediscovery', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    const failedResult = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(failedResult.runs[0]).toMatchObject({
      diagnostics: { evidenceCount: 3, failedCount: 1, succeededCount: 2 },
      result: {
        diagnostics: {
          errors: [expect.objectContaining({ code: 'SOURCE_ANALYSIS_FAILED' })],
          failedCount: 1,
        },
        kind: 'source_error',
      },
      status: 'failed',
    });

    const retried = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(retried.runs[0].status).toBe('analyzing');
    expect(retried.runs[0].threadId).not.toBe(failed.threadId);
    expect(harness.execAgent).toHaveBeenCalledTimes(3);
    expect(harness.getSession().retiredRuns).toContainEqual(
      expect.objectContaining({
        operationId: failed.operationId,
        source: failed.source,
        status: 'failed',
        threadId: failed.threadId,
      }),
    );
  });

  it('retires a completed merge when retrying a failed source', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    const failed = session.runs[0];
    if (!failed.operationId) throw new Error('source not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    const completedMerge = session.mergeRun;
    if (!completedMerge?.operationId) throw new Error('merge not launched');
    harness.complete(completedMerge);
    await harness.orchestrator.getSession({ topicId: 'topic' });

    const retried = await harness.orchestrator.retrySource({
      sessionId: session.id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(retried).not.toHaveProperty('retiredMergeRuns');
    expect(retried.mergeRun).toBeUndefined();
    expect(harness.getSession().retiredMergeRuns).toContainEqual(
      expect.objectContaining({
        operationId: completedMerge.operationId,
        status: 'completed',
        threadId: completedMerge.threadId,
      }),
    );
  });

  it('retires a failed merge when retrying a failed source', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    let session = harness.getSession();
    const failed = session.runs[0];
    if (!failed.operationId) throw new Error('source not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    harness.complete(session.runs[1]);
    await harness.orchestrator.getSession({ topicId: 'topic' });
    session = harness.getSession();
    const failedMerge = session.mergeRun;
    if (!failedMerge?.operationId) throw new Error('merge not launched');
    harness.operations.set(failedMerge.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });

    const retried = await harness.orchestrator.retrySource({
      sessionId: session.id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(retried).not.toHaveProperty('retiredMergeRuns');
    expect(retried.mergeRun).toBeUndefined();
    expect(harness.getSession().retiredMergeRuns).toContainEqual(
      expect.objectContaining({
        operationId: failedMerge.operationId,
        status: 'failed',
        threadId: failedMerge.threadId,
      }),
    );
  });

  it('keeps a failed run recoverable when retry resolution transiently fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    vi.mocked(harness.githubProvider.resolveSource!).mockRejectedValueOnce(
      new UnderstandingSourceIdentificationError({ retryable: true }),
    );

    const firstRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(firstRetry.runs[0]).toMatchObject({ status: 'failed', threadId: failed.threadId });
    expect(firstRetry.errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_RETRY_ACCOUNT_UNAVAILABLE', retryable: true }),
    );

    const secondRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });
    expect(secondRetry.runs[0]).toMatchObject({ status: 'analyzing' });
    expect(harness.getSession().retiredRuns?.[0].threadId).toBe(failed.threadId);
  });

  it('reports a missing failed-source locator as non-retryable without replacing the run', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    await harness.deleteSourceLocator({ runId: failed.threadId });

    const retry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(retry.runs[0]).toMatchObject({ status: 'failed', threadId: failed.threadId });
    expect(retry.errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_RETRY_ACCOUNT_UNAVAILABLE', retryable: false }),
    );
    expect(harness.getSession().retiredRuns).toBeUndefined();
  });

  it('keeps a failed run recoverable when retry locator prewrite fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    harness.putSourceLocator.mockRejectedValueOnce(new Error('redis unavailable'));

    const firstRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });
    expect(firstRetry.runs[0].threadId).toBe(failed.threadId);
    expect(firstRetry.errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_RETRY_ACCOUNT_UNAVAILABLE', retryable: true }),
    );

    const secondRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });
    expect(secondRetry.runs[0].status).toBe('analyzing');
  });

  it('marks a pending source stale when its temporary locator has expired', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const pending = harness.getSession().runs[0];
    harness.setSession({
      id: harness.getSession().id,
      runs: harness.getSession().runs,
      status: harness.getSession().status,
    });
    harness.deleteSourceLocator({ runId: pending.threadId });

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(harness.getSession().runs[0]).toMatchObject({ status: 'stale' });
    expect(harness.getSession().runs[0].status).not.toBe('failed');
  });

  it('recovers a crashed initialization only after its lease expires', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const pending = harness.getSession().runs[0];
    harness.setSession({
      ...harness.getSession(),
      initializationStartedAt: '2026-07-17T08:30:00.000Z',
      initializedAt: undefined,
    });
    await harness.deleteSourceLocator({ runId: pending.threadId });

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });
    expect(harness.getSession().runs[0]).toMatchObject({ status: 'pending' });

    harness.setNow(new Date('2026-07-17T08:35:00.001Z'));
    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });
    expect(harness.getSession().runs[0]).toMatchObject({ status: 'stale' });
  });

  it('leaves a recent collecting source untouched while its lease is healthy', async () => {
    harness = createHarness('gmail');
    let releaseCollection!: (value: Awaited<ReturnType<UnderstandingProvider['collect']>>) => void;
    vi.mocked(harness.githubProvider.collect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCollection = resolve;
        }),
    );
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const background = harness.scheduled[0]();
    await vi.waitFor(() => expect(harness.getSession().runs[0].status).toBe('collecting'));
    const collectCount = vi.mocked(harness.githubProvider.collect).mock.calls.length;
    const launchCount = harness.execAgent.mock.calls.length;

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(harness.getSession().runs[0]).toMatchObject({
      collectionStartedAt: '2026-07-17T08:30:00.000Z',
      status: 'collecting',
    });
    expect(vi.mocked(harness.githubProvider.collect)).toHaveBeenCalledTimes(collectCount);
    expect(harness.execAgent).toHaveBeenCalledTimes(launchCount);

    releaseCollection({ diagnostics, sourceBrief: '# recovered', sourceCount: 1 });
    await background;
  });

  it('relaunches analysis for an expired collecting source with a stored payload', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const interrupted = harness.getSession().runs[0];
    harness.updateRun(interrupted.threadId, (run) => ({
      collectionStartedAt: '2026-07-17T08:20:00.000Z',
      source: run.source,
      status: 'collecting',
      threadId: run.threadId,
    }));
    harness.setNow(new Date('2026-07-17T08:30:00.000Z'));
    const collectCount = vi.mocked(harness.githubProvider.collect).mock.calls.length;
    const launchCount = harness.execAgent.mock.calls.length;

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(vi.mocked(harness.githubProvider.collect)).toHaveBeenCalledTimes(collectCount);
    expect(harness.execAgent).toHaveBeenCalledTimes(launchCount + 1);
    expect(harness.getSession().runs[0]).toMatchObject({ status: 'analyzing' });
  });

  it('recollects an expired collecting source when only its locator remains', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const interrupted = harness.getSession().runs[0];
    harness.updateRun(interrupted.threadId, (run) => ({
      ...run,
      collectionStartedAt: '2026-07-17T08:20:00.000Z',
      status: 'collecting',
    }));
    harness.setNow(new Date('2026-07-17T08:30:00.000Z'));
    const collectCount = vi.mocked(harness.githubProvider.collect).mock.calls.length;

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(vi.mocked(harness.githubProvider.collect)).toHaveBeenCalledTimes(collectCount + 1);
    expect(harness.getSession().runs[0]).toMatchObject({
      collectionStartedAt: '2026-07-17T08:30:00.000Z',
      status: 'analyzing',
    });
  });

  it('marks an expired collecting source stale when its locator is gone', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const interrupted = harness.getSession().runs[0];
    harness.updateRun(interrupted.threadId, (run) => ({
      ...run,
      collectionStartedAt: '2026-07-17T08:20:00.000Z',
      status: 'collecting',
    }));
    harness.deleteSourceLocator({ runId: interrupted.threadId });
    harness.setNow(new Date('2026-07-17T08:30:00.000Z'));

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(harness.getSession().runs[0]).toMatchObject({ status: 'stale' });
  });

  it('fences a slow original collector after expired recovery replaces its attempt', async () => {
    harness = createHarness('gmail');
    let releaseOriginal!: (value: Awaited<ReturnType<UnderstandingProvider['collect']>>) => void;
    vi.mocked(harness.githubProvider.collect).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseOriginal = resolve;
        }),
    );
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const background = harness.scheduled[0]();
    await vi.waitFor(() => expect(harness.getSession().runs[0].status).toBe('collecting'));
    const originalAttemptId = harness.getSession().runs[0].collectionAttemptId;
    harness.setNow(new Date('2026-07-17T08:40:00.000Z'));

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });
    const recovered = harness.getSession().runs[0];
    expect(recovered).toMatchObject({ status: 'analyzing' });
    expect(recovered.collectionAttemptId).not.toBe(originalAttemptId);
    expect(harness.execAgent).toHaveBeenCalledTimes(1);

    releaseOriginal({ diagnostics, sourceBrief: '# obsolete original payload', sourceCount: 1 });
    await background;

    expect(harness.execAgent).toHaveBeenCalledTimes(1);
    expect(harness.getSession().runs[0]).toMatchObject({
      collectionAttemptId: recovered.collectionAttemptId,
      operationId: recovered.operationId,
      status: 'analyzing',
    });
  });

  it('does not mark a newer recovery stale when an old recovery loses its locator', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const interrupted = harness.getSession().runs[0];
    harness.updateRun(interrupted.threadId, (run) => ({
      ...run,
      collectionAttemptId: 'attempt-old',
      collectionStartedAt: '2026-07-17T08:20:00.000Z',
      status: 'collecting',
    }));
    harness.deleteSourceLocator({ runId: interrupted.threadId });
    harness.setNow(new Date('2026-07-17T08:30:00.000Z'));
    harness.beforeSessionUpdateAfter(1, () =>
      harness.updateRun(interrupted.threadId, (run) => ({
        ...run,
        assistantMessageId: 'message-new-recovery',
        collectionAttemptId: 'attempt-new-recovery',
        collectionStartedAt: '2026-07-17T08:30:00.000Z',
        operationId: 'operation-new-recovery',
        status: 'analyzing',
      })),
    );

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(harness.getSession().runs[0]).toMatchObject({
      collectionAttemptId: 'attempt-new-recovery',
      operationId: 'operation-new-recovery',
      status: 'analyzing',
    });
  });

  it('does not fail or write payload state after a resume owner is superseded', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const interrupted = harness.getSession().runs[0];
    harness.updateRun(interrupted.threadId, (run) => ({
      ...run,
      collectionAttemptId: 'attempt-old',
      collectionStartedAt: '2026-07-17T08:20:00.000Z',
      status: 'collecting',
    }));
    if (!harness.githubProvider.resolveSource) throw new Error('provider cannot resolve sources');
    vi.mocked(harness.githubProvider.resolveSource).mockRejectedValueOnce(
      new Error('old recovery failed'),
    );
    harness.setNow(new Date('2026-07-17T08:30:00.000Z'));
    const payloadWrites = harness.putSourcePayload.mock.calls.length;
    harness.beforeSessionUpdateAfter(2, () =>
      harness.updateRun(interrupted.threadId, (run) => ({
        ...run,
        assistantMessageId: 'message-new-recovery',
        collectionAttemptId: 'attempt-new-recovery',
        collectionStartedAt: '2026-07-17T08:30:00.000Z',
        operationId: 'operation-new-recovery',
        status: 'analyzing',
      })),
    );

    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });

    expect(harness.getSession().runs[0]).toMatchObject({
      collectionAttemptId: 'attempt-new-recovery',
      operationId: 'operation-new-recovery',
      status: 'analyzing',
    });
    expect(
      harness.putSourcePayload.mock.calls
        .slice(payloadWrites)
        .some(([input]) => input.runId === interrupted.threadId),
    ).toBe(false);
  });

  it('does not persist or clean up an old rejected launch after a newer recovery wins', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    const cleanupCount = harness.deleteSourcePayload.mock.calls.length;
    harness.execAgent.mockRejectedValueOnce(new Error('old launch rejected'));
    harness.beforeSessionUpdateAfter(5, () => {
      const current = harness.getSession().runs[0];
      harness.updateRun(current.threadId, (run) => ({
        ...run,
        assistantMessageId: 'message-new-recovery',
        collectionAttemptId: 'attempt-new-recovery',
        collectionStartedAt: '2026-07-17T08:30:00.000Z',
        operationId: 'operation-new-recovery',
        status: 'analyzing',
      }));
    });

    await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: failed.source.id,
      topicId: 'topic',
    });

    expect(harness.getSession().runs[0]).toMatchObject({
      collectionAttemptId: 'attempt-new-recovery',
      operationId: 'operation-new-recovery',
      status: 'analyzing',
    });
    expect(harness.deleteSourcePayload).toHaveBeenCalledTimes(cleanupCount);
  });

  it('leaves a released source launch recoverable when its manifest update rejects', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-unadopted-source',
        operationId: 'operation-unadopted-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-unadopted-source');
    const releasedRun = harness.getSession().runs[0];
    expect(releasedRun).toMatchObject({ status: 'collecting' });
    expect(releasedRun).not.toHaveProperty('assistantMessageId');
    expect(releasedRun).not.toHaveProperty('operationId');

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });
    expect(result.errors ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'SOURCE_ANALYSIS_FAILED', provider: 'github' }),
    );
  });

  it('keeps a source operation when its manifest update commits before rejecting', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfterCommit();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-adopted-source',
        operationId: 'operation-adopted-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).not.toHaveBeenCalledWith('operation-adopted-source');
    expect(harness.getSession().runs[0]).toMatchObject({
      assistantMessageId: 'message-adopted-source',
      operationId: 'operation-adopted-source',
      status: 'analyzing',
    });
  });

  it('keeps an adopted source operation when its post-commit verification read fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfterCommit();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-adopted-source-read-failure',
        operationId: 'operation-adopted-source-read-failure',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).not.toHaveBeenCalledWith(
      'operation-adopted-source-read-failure',
    );
    expect(harness.getSession().runs[0]).toMatchObject({
      assistantMessageId: 'message-adopted-source-read-failure',
      operationId: 'operation-adopted-source-read-failure',
      status: 'analyzing',
    });
  });

  it('adopts the real source reference when manifest reconciliation is inconclusive', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-inconclusive-source',
        operationId: 'operation-inconclusive-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.getSession().runs[0]).toMatchObject({
      assistantMessageId: 'message-inconclusive-source',
      operationId: 'operation-inconclusive-source',
      status: 'analyzing',
    });
  });

  it('releases an unverified source operation before an expired poll relaunches it', async () => {
    const orchestrator = new UnderstandingOrchestrator({
      ...harness.dependencies,
      collectionConcurrency: 1,
    });
    await orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        vi.mocked(harness.dependencies.sessions.update).mockRejectedValueOnce(
          new Error('injected session update failure'),
        );
        vi.mocked(harness.dependencies.sessions.get).mockRejectedValueOnce(
          new Error('injected session read failure'),
        );
      }
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-inconclusive-source',
        operationId: 'operation-inconclusive-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-inconclusive-source');
    const released = harness.getSession().runs[0];
    expect(released).toMatchObject({ status: 'collecting' });
    expect(released).not.toHaveProperty('assistantMessageId');
    expect(released).not.toHaveProperty('operationId');
    harness.setNow(new Date('2026-07-17T08:36:00.000Z'));

    const recovered = await orchestrator.getSession({ topicId: 'topic' });

    expect(harness.execAgent).toHaveBeenCalledTimes(3);
    expect(recovered.runs[0]).toMatchObject({
      assistantMessageId: `message-${released.threadId}`,
      operationId: `operation-${released.threadId}`,
      status: 'analyzing',
    });
    expect(recovered.runs[0].collectionAttemptId).not.toBe(released.collectionAttemptId);
    expect(recovered.runs[0].operationId).not.toBe('operation-inconclusive-source');
  });

  it('removes a committed source reference after final adoption cleanup', async () => {
    const orchestrator = new UnderstandingOrchestrator({
      ...harness.dependencies,
      collectionConcurrency: 1,
    });
    await orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      const update = vi.mocked(harness.dependencies.sessions.update);
      const updateSession = update.getMockImplementation()!;
      harness.failSessionUpdateAfterCommit();
      update
        .mockImplementationOnce(updateSession)
        .mockRejectedValueOnce(new Error('second manifest update failure'))
        .mockRejectedValueOnce(new Error('third manifest update failure'));
      harness.failSessionRead();
      harness.failSessionRead();
      harness.failSessionRead();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-cleaned-committed-source',
        operationId: 'operation-cleaned-committed-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).toHaveBeenLastCalledWith(
      'operation-cleaned-committed-source',
    );
    const released = harness.getSession().runs[0];
    expect(released).toMatchObject({ status: 'collecting' });
    expect(released).not.toHaveProperty('assistantMessageId');
    expect(released).not.toHaveProperty('operationId');
    harness.setNow(new Date('2026-07-17T08:36:00.000Z'));

    const recovered = await orchestrator.getSession({ topicId: 'topic' });
    expect(recovered.runs[0]).toMatchObject({
      assistantMessageId: expect.any(String),
      operationId: expect.any(String),
      status: 'analyzing',
    });
    expect(recovered.runs[0].operationId).not.toBe('operation-cleaned-committed-source');
  });

  it('adopts the real source reference when its first cleanup attempt fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.deleteAgentOperation.mockRejectedValueOnce(new Error('injected cleanup failure'));
    harness.execAgent.mockImplementationOnce(async () => {
      harness.failSessionUpdateAfter();
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-cleanup-failed-source',
        operationId: 'operation-cleanup-failed-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.getSession().runs[0]).toMatchObject({
      assistantMessageId: 'message-cleanup-failed-source',
      operationId: 'operation-cleanup-failed-source',
      status: 'analyzing',
    });
  });

  it('cleans up a source operation when a newer collection attempt wins after launch', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    harness.execAgent.mockImplementationOnce(async () => {
      const current = harness.getSession().runs[0];
      harness.updateRun(current.threadId, (run) => ({
        ...run,
        assistantMessageId: 'message-new-recovery',
        collectionAttemptId: 'attempt-new-recovery',
        operationId: 'operation-new-recovery',
        status: 'analyzing',
      }));
      return {
        agentId: 'understanding-agent',
        assistantMessageId: 'message-unadopted-source',
        operationId: 'operation-unadopted-source',
        success: true,
      };
    });

    await harness.scheduled[0]();

    expect(harness.deleteAgentOperation).toHaveBeenCalledWith('operation-unadopted-source');
    expect(harness.getSession().runs[0]).toMatchObject({
      collectionAttemptId: 'attempt-new-recovery',
      operationId: 'operation-new-recovery',
      status: 'analyzing',
    });
  });

  it('marks an incomplete source stale when its temporary input has expired', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const incomplete = harness.getSession().runs[0];
    await harness.deleteSourcePayload({ runId: incomplete.threadId });

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs[0]).toMatchObject({ status: 'stale' });
    expect(result.runs[0].result).toBeUndefined();
  });

  it('does not mark a source stale when its result read transiently fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const incomplete = harness.getSession().runs[0];
    if (!incomplete.operationId) throw new Error('run not launched');
    await harness.deleteSourcePayload({ runId: incomplete.threadId });
    harness.failResultRead(
      incomplete.operationId,
      new Error('RAW_RESULT_READ_FAILURE secret-token'),
    );

    const result = await harness.orchestrator.getSession({ topicId: 'topic' });

    expect(result.runs[0]).toMatchObject({ status: 'analyzing' });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: 'RESULT_READ_FAILED',
        provider: 'github',
        retryable: true,
      }),
    );
    expect(JSON.stringify(result)).not.toContain('RAW_RESULT_READ_FAILURE');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('rediscovers and recollects a stale source when its locator is gone', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const incomplete = harness.getSession().runs[0];
    await harness.deleteSourcePayload({ runId: incomplete.threadId });
    harness.deleteSourceLocator({ runId: incomplete.threadId });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    const discoveryCount = vi.mocked(harness.githubProvider.discoverSources).mock.calls.length;
    const identificationCount = vi.mocked(harness.githubProvider.identifySource).mock.calls.length;
    const collectionCount = vi.mocked(harness.githubProvider.collect).mock.calls.length;

    const retried = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: incomplete.source.id,
      topicId: 'topic',
    });

    expect(vi.mocked(harness.githubProvider.discoverSources)).toHaveBeenCalledTimes(
      discoveryCount + 1,
    );
    expect(vi.mocked(harness.githubProvider.identifySource)).toHaveBeenCalledTimes(
      identificationCount + 1,
    );
    expect(vi.mocked(harness.githubProvider.collect)).toHaveBeenCalledTimes(collectionCount + 1);
    expect(retried.runs[0]).toMatchObject({
      source: { externalAccountId: incomplete.source.externalAccountId, provider: 'github' },
      status: 'analyzing',
    });
  });

  it('keeps a stale run recoverable when rediscovery identification transiently fails', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    const stale = harness.getSession().runs[0];
    harness.deleteSourceLocator({ runId: stale.threadId });
    await harness.orchestrator.resumePendingSources({ topicId: 'topic' });
    vi.mocked(harness.githubProvider.identifySource).mockRejectedValueOnce(
      new UnderstandingSourceIdentificationError({ retryable: true }),
    );

    const firstRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: stale.source.id,
      topicId: 'topic',
    });
    expect(firstRetry.runs[0]).toMatchObject({ status: 'stale', threadId: stale.threadId });
    expect(firstRetry.errors).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_RETRY_ACCOUNT_UNAVAILABLE', retryable: true }),
    );

    const secondRetry = await harness.orchestrator.retrySource({
      sessionId: harness.getSession().id,
      sourceId: stale.source.id,
      topicId: 'topic',
    });
    expect(secondRetry.runs[0].status).toBe('analyzing');
  });

  it('allows only one concurrent retry to collect and launch a failed source', async () => {
    await harness.orchestrator.start({ topicId: 'topic' }, harness.schedule);
    await harness.scheduled[0]();
    const failed = harness.getSession().runs[0];
    if (!failed.operationId) throw new Error('run not launched');
    harness.operations.set(failed.operationId, { status: 'error' });
    await harness.orchestrator.getSession({ topicId: 'topic' });
    const collectCount = vi.mocked(harness.githubProvider.collect).mock.calls.length;
    const launchCount = harness.execAgent.mock.calls.length;
    harness.synchronizeNextSessionReads(2);

    const results = await Promise.all([
      harness.orchestrator.retrySource({
        sessionId: harness.getSession().id,
        sourceId: failed.source.id,
        topicId: 'topic',
      }),
      harness.orchestrator.retrySource({
        sessionId: harness.getSession().id,
        sourceId: failed.source.id,
        topicId: 'topic',
      }),
    ]);

    expect(vi.mocked(harness.githubProvider.collect)).toHaveBeenCalledTimes(collectCount + 1);
    expect(harness.execAgent).toHaveBeenCalledTimes(launchCount + 1);
    expect(new Set(results.map(({ runs }) => runs[0].threadId)).size).toBe(1);
    expect(results[0].runs[0].threadId).not.toBe(failed.threadId);
    expect(harness.deleteSourceLocator).toHaveBeenCalledTimes(1);
  });
});
