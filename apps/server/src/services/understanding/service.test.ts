import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { projectOnboardingUnderstandingSessionStatus } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUnderstandingProviderRegistry } from './providers';
import { UnderstandingService } from './service';
import type { UnderstandingProvider } from './types';

vi.mock('@lobechat/database', () => {
  class DomainError extends Error {}
  return {
    StaleUnderstandingRunError: DomainError,
    StaleUnderstandingSessionError: DomainError,
    UnderstandingConfirmationRepository: class {},
    UnderstandingPreconditionError: DomainError,
    UnderstandingResourceNotFoundError: DomainError,
    UnderstandingResultRepository: class {},
    UnderstandingSessionNotFoundError: DomainError,
    UnderstandingSessionRepository: class {},
  };
});
vi.mock('@/database/models/agent', () => ({ AgentModel: class {} }));
vi.mock('@/database/models/agentOperation', () => ({ AgentOperationModel: class {} }));
vi.mock('@/database/models/message', () => ({ MessageModel: class {} }));
vi.mock('@/database/models/topic', () => ({ TopicModel: class {} }));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: class {} }));

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [{ description: 'Builds agent systems.', salience: 96, title: 'Agents' }],
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

const provider = (id: string): UnderstandingProvider => ({
  collect: vi.fn(async () => ({
    diagnostics,
    sourceBrief: `${id === 'github' ? '# Markdown' : '<gmail />'} PRIVATE_SOURCE_DOCUMENT`,
    sourceCount: 3,
  })),
  discoverSources: vi.fn(async () => [
    {
      candidateId: `${id}-candidate`,
      credentialOrigin: 'connector' as const,
      credentialReference: `${id}-reference`,
      provider: id,
    },
  ]),
  id,
  identifySource: vi.fn(async () => ({
    credential: { token: `${id}-secret` },
    displayName: `${id} account`,
    externalAccountId: `${id}-user`,
    grantedScopes: [],
  })),
  originPriority: ['connector'],
  requiredScopes: [],
  resolveSource: vi.fn(async (reference, locator) => ({
    ...reference,
    ...locator,
    credential: { token: `${id}-refreshed-secret` },
    grantedScopes: [],
  })),
  usefulOptionalScopes: [],
});

const createHarness = () => {
  let sequence = 0;
  let session: OnboardingUnderstandingSession | undefined;
  const payloads = new Map<string, { brief: string; diagnostics: CollectionDiagnostics }>();
  const locators = new Map<string, any>();
  const contents = new Map<string, unknown>();
  const storedResults = new Map<string, OnboardingUnderstandingMessageMetadata>();
  const github = provider('github');
  const gmail = provider('gmail');
  const execAgent = vi.fn(async ({ appContext }: any) => ({
    assistantMessageId: `message-${appContext.threadId}`,
    autoStarted: true,
    operationId: `operation-${appContext.threadId}`,
  }));
  const confirmation = vi.fn(async () => ({ confirmed: true }));
  const sourceKey = ({ sourceId, threadId }: any) => `${sourceId}:${threadId}`;
  const applyStatus = (next: OnboardingUnderstandingSession) => ({
    ...next,
    status: projectOnboardingUnderstandingSessionStatus(next),
  });
  const dependencies = {
    agent: { execAgent },
    agentId: 'understanding-agent',
    confirmation: { confirm: confirmation },
    context: { userId: 'user' },
    ids: () => `id-${++sequence}`,
    messages: { readContent: vi.fn(async (id: string) => contents.get(id)) },
    operations: { findById: vi.fn(async () => ({ status: 'running' })) },
    registry: createUnderstandingProviderRegistry([github, gmail]),
    results: {
      ensureThread: vi.fn(),
      finalizeMerge: vi.fn(async ({ assistantMessageId, metadata, threadId }: any) => {
        storedResults.set(assistantMessageId, metadata);
        session = applyStatus({
          ...session!,
          mergeRun: {
            ...session!.mergeRun!,
            assistantMessageId,
            diagnostics: {
              evidenceCount: metadata.diagnostics.evidenceCount,
              failedCount: metadata.diagnostics.failedCount,
              succeededCount: metadata.diagnostics.succeededCount,
            },
            resultId: metadata.resultId,
            status: metadata.kind === 'merged' ? 'completed' : 'failed',
            threadId,
          },
        });
        return metadata;
      }),
      finalizeSource: vi.fn(async ({ assistantMessageId, metadata, sourceId }: any) => {
        storedResults.set(assistantMessageId, metadata);
        session = applyStatus({
          ...session!,
          runs: session!.runs.map((run) =>
            run.source.id === sourceId
              ? {
                  ...run,
                  assistantMessageId,
                  diagnostics: {
                    evidenceCount: metadata.diagnostics.evidenceCount,
                    failedCount: metadata.diagnostics.failedCount,
                    succeededCount: metadata.diagnostics.succeededCount,
                  },
                  resultId: metadata.resultId,
                  status: metadata.kind === 'source' ? 'completed' : 'failed',
                }
              : run,
          ),
        });
        return metadata;
      }),
      readMerge: vi.fn(async ({ assistantMessageId }: any) =>
        storedResults.get(assistantMessageId),
      ),
      readSource: vi.fn(async ({ assistantMessageId }: any) =>
        storedResults.get(assistantMessageId),
      ),
    },
    sessions: {
      attachWorkflowRun: vi.fn(
        async (_topicId: string, _sessionId: string, workflowRunId: string) => {
          session = { ...session!, workflowRunId };
          return session;
        },
      ),
      get: vi.fn(async () => session),
      install: vi.fn(async (_topicId: string, value: OnboardingUnderstandingSession) => {
        session ??= value;
        return session;
      }),
      update: vi.fn(async (_topicId: string, sessionId: string, mutate: any) => {
        if (session?.id !== sessionId) throw new Error('stale session');
        session = applyStatus(mutate(session));
        return session;
      }),
      updateSourceRun: vi.fn(
        async (
          _topicId: string,
          sessionId: string,
          sourceId: string,
          threadId: string,
          patch: any,
        ) => {
          if (session?.id !== sessionId) throw new Error('stale session');
          const run = session.runs.find(({ source }) => source.id === sourceId);
          if (!run || run.threadId !== threadId) throw new Error('stale run');
          session = applyStatus({
            ...session,
            runs: session.runs.map((item) => (item === run ? { ...item, ...patch } : item)),
          });
          return session;
        },
      ),
    },
    sourceStore: {
      deleteSourcePayload: vi.fn(async (input: any) => void payloads.delete(sourceKey(input))),
      get: vi.fn(async (input: any) => payloads.get(sourceKey(input)) ?? null),
      getSourceLocator: vi.fn(async ({ sourceId }: any) => locators.get(sourceId) ?? null),
      put: vi.fn(
        async (input: any) =>
          void payloads.set(sourceKey(input), {
            brief: input.brief,
            diagnostics: input.diagnostics,
          }),
      ),
      putSourceLocator: vi.fn(
        async ({ locator, sourceId }: any) => void locators.set(sourceId, locator),
      ),
    },
    topic: { assertActiveOnboardingTopic: vi.fn() },
  };
  const service = new UnderstandingService(dependencies as any);
  return {
    confirmation,
    contents,
    dependencies,
    execAgent,
    github,
    gmail,
    locators,
    payloads,
    service,
    session: () => session!,
    storedResults,
  };
};

const initializeAndDiscover = async (harness: ReturnType<typeof createHarness>) => {
  const session = await harness.service.initialize('topic');
  const branches = await harness.service.discover('topic', session.id);
  return { branches, session };
};

describe('UnderstandingService', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('initializes an empty pending session idempotently', async () => {
    const first = await harness.service.initialize('topic');
    const second = await harness.service.initialize('topic');

    expect(first).toEqual({ id: 'id-1', runs: [], status: 'pending' });
    expect(second).toBe(first);
    expect(harness.dependencies.sessions.install).toHaveBeenCalledTimes(1);
  });

  it('discovers providers once, stores safe locators before publishing branches, and replays', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const replay = await harness.service.discover('topic', session.id);

    expect(branches).toHaveLength(2);
    expect(replay).toEqual(branches);
    expect(harness.github.discoverSources).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(branches)).not.toContain('secret');
    expect(JSON.stringify(harness.session())).not.toContain('credentialReference');
    expect(
      harness.dependencies.sourceStore.putSourceLocator.mock.invocationCallOrder[1],
    ).toBeLessThan(harness.dependencies.sessions.update.mock.invocationCallOrder[0]);
  });

  it('keeps partial discovery results and bounded provider errors', async () => {
    vi.mocked(harness.gmail.discoverSources).mockRejectedValueOnce(
      new Error('private oauth error'),
    );
    const { branches } = await initializeAndDiscover(harness);

    expect(branches).toHaveLength(1);
    expect(harness.session().errors).toMatchObject([
      { code: 'UNDERSTANDING_SOURCE_DISCOVERY_FAILED', provider: 'gmail' },
    ]);
    expect(JSON.stringify(harness.session())).not.toContain('private oauth error');
  });

  it('re-resolves current credentials and keeps raw collected documents out of step output', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const branch = branches.find(({ sourceId }) => sourceId.startsWith('github'))!;
    const output = await harness.service.collectSource({
      ...branch,
      sessionId: session.id,
      topicId: 'topic',
    });

    expect(harness.github.resolveSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: branch.sourceId }),
      expect.objectContaining({ credentialReference: 'github-reference' }),
      { userId: 'user' },
    );
    expect(output).toEqual({
      diagnostics: { evidenceCount: 3, failedCount: 0, succeededCount: 2 },
      sourceCount: 3,
    });
    expect(JSON.stringify(output)).not.toContain('PRIVATE_SOURCE_DOCUMENT');
  });

  it('rediscovers only the affected provider when its locator expires', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const branch = branches.find(({ sourceId }) => sourceId.startsWith('github'))!;
    harness.locators.delete(branch.sourceId);
    vi.clearAllMocks();

    await harness.service.collectSource({ ...branch, sessionId: session.id, topicId: 'topic' });

    expect(harness.github.discoverSources).toHaveBeenCalledOnce();
    expect(harness.gmail.discoverSources).not.toHaveBeenCalled();
  });

  it('fences an old retry thread from collection', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const branch = branches[0];
    await harness.dependencies.sessions.updateSourceRun(
      'topic',
      session.id,
      branch.sourceId,
      branch.threadId,
      { status: 'failed' },
    );
    const retry = await harness.service.prepareRetry({
      sessionId: session.id,
      sourceId: branch.sourceId,
      topicId: 'topic',
    });

    await expect(
      harness.service.collectSource({ ...branch, sessionId: session.id, topicId: 'topic' }),
    ).rejects.toThrow();
    expect(retry.threadId).not.toBe(branch.threadId);
  });

  it('launches source analysis with the private payload but returns identifiers only', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const input = { ...branches[0], sessionId: session.id, topicId: 'topic' };
    await harness.service.collectSource(input);
    const launch = await harness.service.launchSourceAnalysis(input);

    expect(harness.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeralUserMessage: expect.stringContaining('PRIVATE_SOURCE_DOCUMENT'),
        maxSteps: 1,
      }),
    );
    expect(launch).toMatchObject({ operationId: expect.any(String), success: true });
    expect(JSON.stringify(launch)).not.toContain('PRIVATE_SOURCE_DOCUMENT');
    expect(harness.session().runs[0]).not.toHaveProperty('operationId');
  });

  it('finalizes valid and invalid source output and deletes terminal payloads', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const first = { ...branches[0], sessionId: session.id, topicId: 'topic' };
    const second = { ...branches[1], sessionId: session.id, topicId: 'topic' };
    await harness.service.collectSource(first);
    await harness.service.collectSource(second);
    const firstLaunch = await harness.service.launchSourceAnalysis(first);
    const secondLaunch = await harness.service.launchSourceAnalysis(second);
    harness.contents.set(firstLaunch.assistantMessageId, JSON.stringify(analysis));
    harness.contents.set(secondLaunch.assistantMessageId, 'not json');

    await expect(
      harness.service.finalizeSource({
        ...first,
        assistantMessageId: firstLaunch.assistantMessageId,
      }),
    ).resolves.toMatchObject({ kind: 'source' });
    await expect(
      harness.service.finalizeSource({
        ...second,
        assistantMessageId: secondLaunch.assistantMessageId,
      }),
    ).resolves.toMatchObject({ kind: 'source_error' });
    expect(harness.payloads).toHaveLength(0);
  });

  it('persists a stable source failure even before an agent launch', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const input = { ...branches[0], sessionId: session.id, topicId: 'topic' };

    const result = await harness.service.failSource(input);

    expect(result).toMatchObject({ kind: 'source_error', resultId: 'id-4' });
    expect(harness.dependencies.results.ensureThread).toHaveBeenCalled();
  });

  it('allows one merge launcher, finalizes it, and preserves an explicit source pronoun', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    for (const branch of branches) {
      const input = { ...branch, sessionId: session.id, topicId: 'topic' };
      await harness.service.collectSource(input);
      const launch = await harness.service.launchSourceAnalysis(input);
      harness.contents.set(launch.assistantMessageId, JSON.stringify(analysis));
      await harness.service.finalizeSource({
        ...input,
        assistantMessageId: launch.assistantMessageId,
      });
    }
    const launch = await harness.service.launchMerge('topic', session.id, 'merge-thread');
    const loser = await harness.service.launchMerge('topic', session.id, 'other-thread');
    expect(loser).toEqual({ skipped: true, threadId: 'merge-thread' });
    expect(harness.execAgent).toHaveBeenCalledTimes(3);
    if ('skipped' in launch) throw new Error('expected merge launch');
    harness.contents.set(
      launch.assistantMessageId,
      JSON.stringify({ ...analysis, profile: { ...analysis.profile, pronoun: 'non-specific' } }),
    );

    const result = await harness.service.finalizeMerge({
      assistantMessageId: launch.assistantMessageId,
      sessionId: session.id,
      threadId: launch.threadId,
      topicId: 'topic',
    });
    expect(result).toMatchObject({ analysis: { profile: { pronoun: 'she/her' } }, kind: 'merged' });
  });

  it('polls progressively without writes and delegates confirmation directly', async () => {
    const { branches, session } = await initializeAndDiscover(harness);
    const input = { ...branches[0], sessionId: session.id, topicId: 'topic' };
    await harness.service.failSource({ ...input, assistantMessageId: 'failure-message' });
    vi.clearAllMocks();

    const polled = await harness.service.get('topic');
    const confirmed = await harness.service.confirm({
      resultId: 'result',
      sessionId: session.id,
      topicId: 'topic',
    });

    expect(polled.runs[0].result).toMatchObject({ kind: 'source_error' });
    expect(harness.dependencies.sessions.update).not.toHaveBeenCalled();
    expect(harness.execAgent).not.toHaveBeenCalled();
    expect(harness.dependencies.sourceStore.deleteSourcePayload).not.toHaveBeenCalled();
    expect(confirmed).toEqual({ confirmed: true });
    expect(harness.confirmation).toHaveBeenCalledOnce();
  });
});
