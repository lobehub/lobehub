import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingService, type UnderstandingServiceDependencies } from './service';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import type { UnderstandingProvider } from './types';

type WriterInput = Parameters<
  ReturnType<UnderstandingServiceDependencies['writerRuntime']>['agent']['execAgent']
>[0];

const { mockAssertWorkflowAvailable, mockTriggerProviders } = vi.hoisted(() => ({
  mockAssertWorkflowAvailable: vi.fn(),
  mockTriggerProviders: vi.fn(),
}));

vi.mock('@/server/workflows/onboardingUnderstanding', () => ({
  OnboardingUnderstandingWorkflow: {
    assertAvailable: mockAssertWorkflowAvailable,
    triggerProviders: mockTriggerProviders,
  },
}));

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [
      {
        description: 'TEST_INTEREST_DESCRIPTION',
        salience: 96,
        title: 'TEST_INTEREST_TITLE',
      },
    ],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'TEST_PERSONA_CONTENT',
    reasoning: 'TEST_PERSONA_REASONING',
    tagline: 'TEST_PERSONA_TAGLINE',
  },
  profile: {
    description: 'TEST_PROFILE_DESCRIPTION',
    domains: ['TEST_PROFILE_DOMAIN'],
    name: 'TEST_PROFILE_NAME',
    pronoun: 'TEST_PROFILE_PRONOUN',
    roles: ['TEST_PROFILE_ROLE'],
    summary: 'TEST_PROFILE_SUMMARY',
    tagline: 'TEST_PROFILE_TAGLINE',
  },
};

const diagnostics: CollectionDiagnostics = {
  errors: [],
  evidenceCount: 3,
  failedCount: 0,
  succeededCount: 2,
};

const providerState = (
  status: 'pending' | 'running' | 'completed' | 'failed',
  revision = status === 'pending' ? 0 : 1,
) => ({
  errors: [],
  failedCount: 0,
  revision,
  status,
  succeededCount: status === 'completed' ? 2 : 0,
});

const createSession = (
  sources: OnboardingUnderstandingSession['sources'] = {
    github: providerState('pending'),
    gmail: providerState('pending'),
  },
): OnboardingUnderstandingSession => ({ id: 'session-1', sources });

const storedContext = (
  providerId: string,
  context: string,
  revision = 1,
): StoredUnderstandingProviderContext => ({
  context,
  diagnostics,
  providerId,
  revision,
  sourceCount: 3,
});

const createHarness = (initialSession?: OnboardingUnderstandingSession) => {
  let session = initialSession;
  let runningOperation:
    { assistantMessageId: string; operationId: string; threadId?: string | null } | undefined;
  let latestAssistant:
    | { content?: unknown; error?: unknown; id: string; role: string; threadId?: string | null }
    | undefined;
  const stored = new Map<string, StoredUnderstandingProviderContext>();
  const assistantMetadata = new Map<string, OnboardingUnderstandingMessageMetadata>();
  const providers = new Map<string, UnderstandingProvider>();
  const githubCollect = vi.fn(async () => ({
    context: 'Provider: github\n\n# Source Brief\n\nPRIVATE_GITHUB_CONTEXT',
    diagnostics,
    sourceCount: 3,
  }));
  providers.set('github', { collect: githubCollect, id: 'github' });
  providers.set('gmail', {
    collect: vi.fn(async () => ({
      context:
        'Provider: gmail\n\n# Source Brief\n\n```xml\n<gmail>PRIVATE_GMAIL_CONTEXT</gmail>\n```',
      diagnostics,
      sourceCount: 3,
    })),
    id: 'gmail',
  });

  const repository = {
    commitWriting: vi.fn(async (_input: unknown) => ({ published: true })),
    completeProvider: vi.fn(
      async ({ providerId, revision }: { providerId: string; revision: number }) => {
        const transition = {
          ...session!,
          sources: {
            ...session!.sources,
            [providerId]: providerState('completed', revision),
          },
        };
        session = transition;
        return transition;
      },
    ),
    confirm: vi.fn(async () => ({ personaVersion: 1 })),
    expireProviderContexts: vi.fn(async () => session!),
    failProvider: vi.fn(async () => session!),
    failWriting: vi.fn(async ({ error, sourceFingerprint }) => {
      session = {
        ...session!,
        writing: {
          error,
          resultMessageId: session?.writing?.resultMessageId,
          sourceFingerprint,
          status: 'failed',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      };
      return session;
    }),
    get: vi.fn(async () => session),
    initialize: vi.fn(async (_topicId: string, sessionId: string, providerIds: string[]) => {
      session = {
        id: sessionId,
        sources: Object.fromEntries(providerIds.map((id) => [id, providerState('pending')])),
      } as OnboardingUnderstandingSession;
      return session;
    }),
    markProviderRunning: vi.fn(async (_topicId: string, _sessionId: string, providerId: string) => {
      const revision = (session?.sources[providerId]?.revision ?? 0) + 1;
      session = {
        ...session!,
        sources: { ...session!.sources, [providerId]: providerState('running', revision) },
      };
      return { revision };
    }),
    prepareWriting: vi.fn(async ({ sourceFingerprint, threadId }) => {
      session = {
        ...session!,
        writing: {
          resultMessageId: session?.writing?.resultMessageId,
          sourceFingerprint,
          status: 'running',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      };
      return { ready: true, threadId };
    }),
  };
  const sourceStore = {
    deleteSession: vi.fn(),
    get: vi.fn(
      async ({ providerId, revision }: { providerId: string; revision: number }) =>
        stored.get(`${providerId}:${revision}`) ?? null,
    ),
    put: vi.fn(async (value: StoredUnderstandingProviderContext) => {
      stored.set(`${value.providerId}:${value.revision}`, value);
    }),
  };
  const sourceStoreFactory = vi.fn(() => sourceStore);
  const execAgent = vi.fn(async (_input: WriterInput) => ({
    assistantMessageId: 'assistant-new',
    operationId: 'operation-new',
    success: true as const,
  }));
  const executeOperation = vi.fn(async () => ({ status: 'done' }));
  const writerAgentId = vi.fn(async () => 'agent-1');
  const writerRuntimeFactory = vi.fn(() => ({ agent: { execAgent }, executeOperation }));
  const messages = {
    findById: vi.fn(async (id: string) => ({
      content: JSON.stringify(analysis),
      metadata: assistantMetadata.has(id)
        ? { onboardingUnderstanding: assistantMetadata.get(id) }
        : undefined,
    })),
    findLatestAssistantMessageByThread: vi.fn(async () => latestAssistant),
  };
  const dependencies: UnderstandingServiceDependencies = {
    connectorData: {} as UnderstandingServiceDependencies['connectorData'],
    ids: () => 'session-new',
    messages,
    persona: { getLatestPersonaDocument: vi.fn(async () => null) },
    providers,
    repository,
    sourceStore: sourceStoreFactory,
    topic: {
      assertActiveOnboardingTopic: vi.fn(),
      findById: vi.fn(async () => ({ metadata: { runningOperation } })),
    },
    userId: 'user-1',
    writerAgentId,
    writerRuntime: writerRuntimeFactory,
  };

  return {
    dependencies,
    execAgent,
    executeOperation,
    githubCollect,
    messages,
    repository,
    service: new UnderstandingService(dependencies),
    setLatestAssistant: (value: typeof latestAssistant) => (latestAssistant = value),
    setRunningOperation: (value: typeof runningOperation) => (runningOperation = value),
    setSession: (value: OnboardingUnderstandingSession) => (session = value),
    sourceStore,
    sourceStoreFactory,
    stored,
    writerAgentId,
    writerRuntimeFactory,
  };
};

describe('UnderstandingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerProviders.mockResolvedValue({ workflowRunId: 'workflow-1' });
  });

  it('starts static providers with deterministic pending revisions', async () => {
    const harness = createHarness();

    await expect(harness.service.start('topic-1')).resolves.toMatchObject({
      id: 'session-new',
      status: 'processing',
    });
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      {
        providers: [
          { id: 'github', revision: 1 },
          { id: 'gmail', revision: 1 },
        ],
        sessionId: 'session-new',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      { workflowRunId: 'onboarding-understanding-initial-session-new' },
    );
  });

  it('stores one exact provider revision and returns its completion fingerprint', async () => {
    const harness = createHarness(
      createSession({ github: providerState('pending', 0), gmail: providerState('running', 1) }),
    );
    harness.stored.set('github:0', storedContext('github', 'older', 0));
    harness.repository.completeProvider.mockImplementationOnce(async () => {
      const ownTransition = createSession({
        github: providerState('completed', 1),
        gmail: providerState('running', 1),
      });
      harness.setSession(
        createSession({
          github: providerState('completed', 1),
          gmail: providerState('completed', 1),
        }),
      );
      return ownTransition;
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ sourceFingerprint: 'github@1', status: 'completed' });
    expect(harness.stored.get('github:0')?.context).toBe('older');
    expect(harness.stored.get('github:1')?.context).toContain('PRIVATE_GITHUB_CONTEXT');
    expect(harness.githubCollect).toHaveBeenCalledWith({
      connectorData: harness.dependencies.connectorData,
      userId: 'user-1',
    });
    expect(harness.sourceStoreFactory).toHaveBeenCalledOnce();
    expect(harness.writerAgentId).not.toHaveBeenCalled();
    expect(harness.writerRuntimeFactory).not.toHaveBeenCalled();
  });

  it('replays a completed provider revision after commit-before-ack without recollecting', async () => {
    const harness = createHarness(createSession({ github: providerState('running', 1) }));

    const first = await harness.service.processProvider({
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    const replay = await harness.service.processProvider({
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(first).toMatchObject({ sourceFingerprint: 'github@1', status: 'completed' });
    expect(replay).toEqual(first);
    expect(harness.githubCollect).toHaveBeenCalledOnce();
    expect(harness.sourceStore.put).toHaveBeenCalledOnce();
    expect(harness.repository.completeProvider).toHaveBeenCalledOnce();
  });

  it('writes GitHub Markdown and Gmail XML only through the ephemeral writer input', async () => {
    const fingerprint = 'github@1,gmail@1';
    const harness = createHarness(
      createSession({
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      }),
    );
    harness.stored.set('github:1', storedContext('github', '# GitHub\n\nGITHUB_MARKDOWN'));
    harness.stored.set(
      'gmail:1',
      storedContext('gmail', '```xml\n<gmailMessages>GMAIL_XML</gmailMessages>\n```'),
    );

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: fingerprint,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-new' });
    const writerInput = harness.execAgent.mock.calls[0][0];
    expect(writerInput.ephemeralUserMessage).toContain('# GitHub\n\nGITHUB_MARKDOWN');
    expect(writerInput.ephemeralUserMessage).toContain(
      '```xml\n<gmailMessages>GMAIL_XML</gmailMessages>\n```',
    );
    expect(JSON.stringify(harness.repository.commitWriting.mock.calls[0][0])).not.toContain(
      'GITHUB_MARKDOWN',
    );
    expect(harness.sourceStore.get.mock.invocationCallOrder.at(-1)).toBeLessThan(
      harness.repository.prepareWriting.mock.invocationCallOrder[0],
    );
    expect(harness.writerAgentId).toHaveBeenCalledOnce();
    expect(harness.sourceStoreFactory).toHaveBeenCalledOnce();
    expect(harness.writerRuntimeFactory).toHaveBeenCalledOnce();
  });

  it('polls without resolving the writer agent', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));

    await expect(harness.service.get('topic-1')).resolves.toMatchObject({ id: 'session-1' });

    expect(harness.writerAgentId).not.toHaveBeenCalled();
    expect(harness.sourceStoreFactory).not.toHaveBeenCalled();
    expect(harness.writerRuntimeFactory).not.toHaveBeenCalled();
  });

  it('records a current writing failure before prepareWriting runs', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));

    await expect(
      harness.service.failWriting({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({
      writing: { sourceFingerprint: 'github@1', status: 'failed' },
    });
    expect(harness.repository.prepareWriting).not.toHaveBeenCalled();
  });

  it.each([
    {
      expected: 'github@1',
      missing: undefined,
      name: 'stale fingerprint',
    },
    {
      expected: 'calendar@1,github@1,gmail@1',
      missing: [
        { providerId: 'calendar', revision: 1 },
        { providerId: 'gmail', revision: 1 },
      ],
      name: 'missing exact contexts',
    },
  ])(
    'returns unpublished for $name without launching the writer',
    async ({ expected, missing }) => {
      const harness = createHarness(
        createSession({
          ...(missing ? { calendar: providerState('completed', 1) } : {}),
          github: providerState('completed', 1),
          gmail: providerState('completed', 1),
        }),
      );
      harness.stored.set('github:1', storedContext('github', '# GitHub'));
      if (!missing) harness.stored.set('gmail:1', storedContext('gmail', '<gmail/>'));

      await expect(
        harness.service.processCollected({
          expectedSourceFingerprint: expected,
          sessionId: 'session-1',
          topicId: 'topic-1',
        }),
      ).resolves.toEqual({ published: false, sourceFingerprint: expected });
      if (missing) {
        expect(harness.repository.expireProviderContexts).toHaveBeenCalledWith({
          providers: missing,
          sessionId: 'session-1',
          sourceFingerprint: expected,
          topicId: 'topic-1',
        });
      } else {
        expect(harness.repository.expireProviderContexts).not.toHaveBeenCalled();
      }
      expect(harness.execAgent).not.toHaveBeenCalled();
    },
  );

  it.each(['running-operation', 'completed-assistant'] as const)(
    'recovers a valid %s without relaunching the agent',
    async (recovery) => {
      const fingerprint = 'github@1';
      const harness = createHarness(createSession({ github: providerState('completed', 1) }));
      harness.stored.set('github:1', storedContext('github', '# GitHub'));
      if (recovery === 'running-operation') {
        const threadId = 'thd_02fa61d8cee35a4387ccc990';
        harness.setRunningOperation({
          assistantMessageId: 'assistant-running',
          operationId: 'operation-running',
          threadId,
        });
      } else {
        harness.setLatestAssistant({
          content: JSON.stringify(analysis),
          id: 'assistant-existing',
          role: 'assistant',
        });
      }

      await expect(
        harness.service.processCollected({
          expectedSourceFingerprint: fingerprint,
          sessionId: 'session-1',
          topicId: 'topic-1',
        }),
      ).resolves.toMatchObject({ published: true });
      expect(harness.execAgent).not.toHaveBeenCalled();
      expect(harness.repository.commitWriting).toHaveBeenCalledOnce();
      expect(harness.executeOperation).toHaveBeenCalledTimes(
        recovery === 'running-operation' ? 1 : 0,
      );
      expect(harness.writerRuntimeFactory).toHaveBeenCalledTimes(
        recovery === 'running-operation' ? 1 : 0,
      );
    },
  );
});
