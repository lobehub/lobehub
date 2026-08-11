import {
  UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
  UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
} from '@lobechat/prompts';
import {
  type CollectionDiagnostics,
  type OnboardingUnderstandingMessageMetadata,
  type OnboardingUnderstandingSession,
  RequestTrigger,
  type UnderstandingAnalysis,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnderstandingService, type UnderstandingServiceDependencies } from './service';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import type { UnderstandingProvider } from './types';

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

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [
      {
        description: 'TEST_INTEREST_DESCRIPTION',
        rank: 96,
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
  providers.set('github', {
    collect: githubCollect,
    connectionSource: 'composio',
    id: 'github',
  });
  providers.set('gmail', {
    collect: vi.fn(async () => ({
      context:
        'Provider: gmail\n\n# Source Brief\n\n```xml\n<gmail>PRIVATE_GMAIL_CONTEXT</gmail>\n```',
      diagnostics,
      sourceCount: 3,
    })),
    connectionSource: 'composio',
    id: 'gmail',
  });

  const repository = {
    commitDetailedWriting: vi.fn(async (_input: unknown) => ({ published: true })),
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
    extend: vi.fn(
      async ({ feedback, providerIds }: { feedback?: string; providerIds: string[] }) => {
        const currentFeedback = session?.feedback ?? { revision: 0, turns: [] };
        const nextRevision = feedback ? currentFeedback.revision + 1 : currentFeedback.revision;
        session = {
          ...session!,
          feedback: {
            revision: nextRevision,
            turns: feedback
              ? [
                  ...currentFeedback.turns,
                  {
                    content: feedback,
                    createdAt: '2026-07-24T00:00:00.000Z',
                    revision: nextRevision,
                  },
                ]
              : currentFeedback.turns,
          },
          sources: {
            ...session!.sources,
            ...Object.fromEntries(
              providerIds
                .filter((providerId) => !session!.sources[providerId])
                .map((providerId) => [providerId, providerState('pending')]),
            ),
          },
        };
        return session;
      },
    ),
    failProvider: vi.fn(async () => session!),
    failDetailedWriting: vi.fn(async () => session!),
    failWriting: vi.fn(
      async ({ error, feedbackRevision, generationRevision, sourceFingerprint }) => {
        session = {
          ...session!,
          writing: {
            error,
            feedbackRevision,
            generationRevision,
            resultMessageId: session?.writing?.resultMessageId,
            sourceFingerprint,
            status: 'failed',
            updatedAt: '2026-07-20T00:00:00.000Z',
          },
        };
        return session;
      },
    ),
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
      const feedbackRevision = session?.feedback?.revision ?? 0;
      const generationRevision = (session?.generationRevision ?? 0) + 1;
      session = {
        ...session!,
        generationRevision,
        writing: {
          feedbackRevision,
          generationRevision,
          resultMessageId: session?.writing?.resultMessageId,
          sourceFingerprint,
          status: 'running',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      };
      return { feedbackRevision, generationRevision, ready: true, threadId };
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
  const writerAgent = vi.fn(async () => ({
    id: 'agent-1',
    model: 'gpt-5.4-mini',
    provider: 'lobehub',
  }));
  const generateObject = vi.fn(
    async (
      _input: Parameters<UnderstandingServiceDependencies['generator']['generateObject']>[0],
      _options: Parameters<UnderstandingServiceDependencies['generator']['generateObject']>[1],
    ): Promise<unknown> => analysis,
  );
  type CreateMessageInput = Parameters<UnderstandingServiceDependencies['messages']['create']>[0];
  const messages = {
    create: vi.fn(async (_input: CreateMessageInput) => ({ id: 'assistant-structured' })),
    findById: vi.fn(async (id: string) => ({
      content: JSON.stringify(analysis),
      metadata: assistantMetadata.has(id)
        ? { onboardingUnderstanding: assistantMetadata.get(id) }
        : undefined,
    })),
    findLatestAssistantMessageByThread: vi.fn(async () => latestAssistant),
  };
  const listAvailableProviderIds = vi.fn(async (providerIds: readonly string[]) => [
    ...providerIds,
  ]);
  const dependencies: UnderstandingServiceDependencies = {
    connectorData: {
      listAvailableProviderIds,
    } as unknown as UnderstandingServiceDependencies['connectorData'],
    generator: {
      generateObject:
        generateObject as UnderstandingServiceDependencies['generator']['generateObject'],
    },
    ids: () => 'session-new',
    messages,
    persona: { getLatestPersonaDocument: vi.fn(async () => null) },
    providers,
    repository,
    sourceStore: sourceStoreFactory,
    topic: {
      assertActiveOnboardingTopic: vi.fn(),
    },
    userId: 'user-1',
    writerAgent,
  };

  return {
    dependencies,
    githubCollect,
    generateObject,
    listAvailableProviderIds,
    messages,
    repository,
    service: new UnderstandingService(dependencies),
    setLatestAssistant: (value: typeof latestAssistant) => (latestAssistant = value),
    setAssistantMetadata: (id: string, value: OnboardingUnderstandingMessageMetadata) =>
      assistantMetadata.set(id, value),
    setSession: (value: OnboardingUnderstandingSession) => (session = value),
    sourceStore,
    sourceStoreFactory,
    stored,
    writerAgent,
  };
};

describe('UnderstandingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTriggerProviders.mockResolvedValue({ workflowRunId: 'workflow-1' });
    mockTriggerWriting.mockResolvedValue({ workflowRunId: 'workflow-writing-1' });
  });

  /**
   * @example
   * expect(result.feedback?.revision).toBe(1);
   */
  it('submits cumulative feedback and only newly added sources', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.stored.set('github:1', storedContext('github', '# GitHub'));

    await expect(
      harness.service.revise({
        expectedFeedbackRevision: 0,
        feedback: 'Focus on infrastructure.',
        providerIds: ['github', 'gmail'],
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({
      feedback: { revision: 1 },
      sources: {
        github: { status: 'completed' },
        gmail: { status: 'pending' },
      },
    });

    expect(harness.repository.extend).toHaveBeenCalledWith({
      expectedFeedbackRevision: 0,
      feedback: 'Focus on infrastructure.',
      providerIds: ['github', 'gmail'],
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      {
        providers: [{ id: 'gmail', revision: 1 }],
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        startedAt: expect.any(Number),
        topicId: 'topic-1',
        userId: 'user-1',
      },
      expect.objectContaining({
        workflowRunId: expect.stringContaining('onboarding-understanding-extend-session-1'),
      }),
    );
    expect(mockTriggerWriting).toHaveBeenCalledWith(
      {
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        startedAt: expect.any(Number),
        topicId: 'topic-1',
        userId: 'user-1',
      },
      expect.any(Object),
    );
  });

  /**
   * @example
   * expect(provider.revision).toBe(2);
   */
  it('automatically recollects included sources whose Redis context expired', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.repository.expireProviderContexts.mockImplementationOnce(async () => {
      const expired = createSession({ github: providerState('failed', 1) });
      harness.setSession(expired);
      return expired;
    });

    await harness.service.revise({
      expectedFeedbackRevision: 0,
      feedback: 'Focus on infrastructure.',
      providerIds: [],
      responseLanguage: 'zh-CN',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(harness.repository.expireProviderContexts).toHaveBeenCalledWith({
      providers: [{ providerId: 'github', revision: 1 }],
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
    });
    expect(harness.repository.markProviderRunning).toHaveBeenCalledWith(
      'topic-1',
      'session-1',
      'github',
    );
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [{ id: 'github', revision: 2 }],
      }),
      expect.any(Object),
    );
    expect(mockTriggerWriting).not.toHaveBeenCalled();
  });

  it('starts static providers with deterministic pending revisions', async () => {
    const harness = createHarness();

    await expect(harness.service.start('topic-1', 'zh-CN')).resolves.toMatchObject({
      id: 'session-new',
      status: 'processing',
    });
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      {
        providers: [
          { id: 'github', revision: 1 },
          { id: 'gmail', revision: 1 },
        ],
        responseLanguage: 'zh-CN',
        sessionId: 'session-new',
        startedAt: expect.any(Number),
        topicId: 'topic-1',
        userId: 'user-1',
      },
      { workflowRunId: 'onboarding-understanding-initial-session-new' },
    );
  });

  /**
   * @example
   * expect(result.sources.gmail).toBeUndefined();
   */
  it('excludes providers whose connector client is unavailable before initialization', async () => {
    const harness = createHarness();
    harness.listAvailableProviderIds.mockResolvedValueOnce(['github']);

    await expect(harness.service.start('topic-1', 'zh-CN')).resolves.toMatchObject({
      sources: { github: { status: 'pending' } },
    });

    expect(harness.repository.initialize).toHaveBeenCalledWith('topic-1', 'session-new', [
      'github',
    ]);
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      expect.objectContaining({ providers: [{ id: 'github', revision: 1 }] }),
      expect.any(Object),
    );
  });

  /** @example A temporary availability failure leaves no persisted Understanding session. */
  it('does not initialize a session when provider availability fails transiently', async () => {
    // ROOT CAUSE:
    //
    // Persisting after a transient availability failure creates an incomplete immutable session.
    // Later starts return that existing session and never retry provider initialization.
    //
    // Before: transient errors were converted into an unavailable provider list downstream.
    // We fixed this by propagating the error before repository initialization.
    const harness = createHarness();
    const transientError = new Error('database temporarily unavailable');
    harness.listAvailableProviderIds.mockRejectedValueOnce(transientError);

    await expect(harness.service.start('topic-1', 'zh-CN')).rejects.toBe(transientError);

    expect(harness.repository.initialize).not.toHaveBeenCalled();
    expect(mockTriggerProviders).not.toHaveBeenCalled();
  });

  /**
   * @example
   * expect(result.sources.gmail).toBeUndefined();
   */
  it('starts only the connected providers selected by the onboarding UI', async () => {
    const harness = createHarness();

    await expect(harness.service.start('topic-1', 'zh-CN', ['github'])).resolves.toMatchObject({
      sources: { github: { status: 'pending' } },
    });
    expect(harness.repository.initialize).toHaveBeenCalledWith('topic-1', 'session-new', [
      'github',
    ]);
    expect(mockTriggerProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: [{ id: 'github', revision: 1 }],
      }),
      expect.any(Object),
    );
  });

  /**
   * @example
   * expect(result.sources.gmail.status).toBe('failed');
   */
  it('does not retry a failed provider whose connector is no longer available', async () => {
    const harness = createHarness(createSession({ gmail: providerState('failed', 1) }));
    harness.listAvailableProviderIds.mockResolvedValueOnce([]);

    await expect(
      harness.service.retry({
        providerId: 'gmail',
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ sources: { gmail: { status: 'failed' } } });

    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
    expect(mockTriggerProviders).not.toHaveBeenCalled();
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
    expect(harness.writerAgent).not.toHaveBeenCalled();
    expect(harness.generateObject).not.toHaveBeenCalled();
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

  it('generates the proposal with the native JSON schema', async () => {
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
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-structured' });
    expect(harness.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        provider: 'lobehub',
        schema: UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
        thinking: { type: 'disabled' },
      }),
      { metadata: { trigger: RequestTrigger.Onboarding } },
    );
    const writerInput = harness.generateObject.mock.calls[0][0];
    expect(writerInput.messages[0].content).toContain('every user-visible string value in zh-CN');
    expect(writerInput.messages[1].content).toContain('# GitHub\n\nGITHUB_MARKDOWN');
    expect(writerInput.messages[1].content).toContain(
      '```xml\n<gmailMessages>GMAIL_XML</gmailMessages>\n```',
    );
    expect(JSON.stringify(harness.repository.commitWriting.mock.calls[0][0])).not.toContain(
      'GITHUB_MARKDOWN',
    );
    expect(harness.sourceStore.get.mock.invocationCallOrder.at(-1)).toBeLessThan(
      harness.repository.prepareWriting.mock.invocationCallOrder[0],
    );
    expect(harness.writerAgent).toHaveBeenCalledOnce();
    expect(harness.sourceStoreFactory).toHaveBeenCalledOnce();
    const createdMessage = harness.messages.create.mock.calls[0][0];
    expect(createdMessage).toMatchObject({
      agentId: 'agent-1',
      model: 'gpt-5.4-mini',
      provider: 'lobehub',
      role: 'assistant',
    });
    expect(JSON.parse(createdMessage.content)).toEqual(analysis);
  });

  it('expands the quick composition and original contexts into a detailed persona', async () => {
    const detailedPersona = {
      content: '# Identity\n\nYou build source-grounded systems.\n\n# Working style\n\nYou ship.',
      reasoning: 'Repeated repository activity supports the working-style synthesis.',
      tagline: 'Source-grounded builder',
    };
    const harness = createHarness({
      generationRevision: 1,
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        detailed: { status: 'running', updatedAt: '2026-07-20T00:00:00.000Z' },
        feedbackRevision: 0,
        generationRevision: 1,
        resultMessageId: 'assistant-structured',
        sourceFingerprint: 'github@1',
        status: 'completed',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('github:1', storedContext('github', '# GitHub\n\nGITHUB_MARKDOWN'));
    harness.setAssistantMetadata('assistant-structured', {
      analysis,
      diagnostics,
      feedbackRevision: 0,
      generationRevision: 1,
      kind: 'proposal',
      providers: ['github'],
      resultId: 'assistant-structured',
      sourceFingerprint: 'github@1',
    });
    harness.generateObject.mockResolvedValueOnce(detailedPersona);

    await expect(
      harness.service.processDetailedPersona({
        expectedSourceFingerprint: 'github@1',
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({ published: true, sourceFingerprint: 'github@1' });

    expect(harness.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
      }),
      { metadata: { trigger: RequestTrigger.Onboarding } },
    );
    const writerInput = harness.generateObject.mock.calls[0][0];
    expect(writerInput.messages[0].content).toContain('TEST_INTEREST_TITLE');
    expect(writerInput.messages[1].content).toContain('GITHUB_MARKDOWN');
    expect(harness.repository.commitDetailedWriting).toHaveBeenCalledWith({
      detailedPersona,
      feedbackRevision: 0,
      generationRevision: 1,
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
    });
  });

  /**
   * @example
   * expect(writerInput.messages[0].content).toContain('Focus on infrastructure.');
   */
  it('includes cumulative user feedback in writer instructions', async () => {
    const harness = createHarness({
      feedback: {
        revision: 2,
        turns: [
          {
            content: 'Focus on infrastructure.',
            createdAt: '2026-07-24T00:00:00.000Z',
            revision: 1,
          },
          {
            content: 'Do not infer interests from newsletters.',
            createdAt: '2026-07-24T00:01:00.000Z',
            revision: 2,
          },
        ],
      },
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
    });
    harness.stored.set('github:1', storedContext('github', '# GitHub'));

    await harness.service.processCollected({
      expectedSourceFingerprint: 'github@1',
      responseLanguage: 'zh-CN',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    const writerInput = harness.generateObject.mock.calls[0][0];
    expect(writerInput.messages[0].content).toContain('Focus on infrastructure.');
    expect(writerInput.messages[0].content).toContain('Do not infer interests from newsletters.');
    expect(writerInput.messages[1].content).not.toContain('Focus on infrastructure.');
    expect(harness.repository.commitWriting).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackRevision: 2,
        generationRevision: 1,
      }),
    );
  });

  it('polls without resolving the writer agent', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));

    await expect(harness.service.get('topic-1')).resolves.toMatchObject({ id: 'session-1' });

    expect(harness.writerAgent).not.toHaveBeenCalled();
    expect(harness.sourceStoreFactory).not.toHaveBeenCalled();
    expect(harness.generateObject).not.toHaveBeenCalled();
  });

  /** @example A workflow failure after collection creates a terminal writing state. */
  it('records a writing failure before a generation is prepared', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));

    await expect(
      harness.service.failWriting({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({
      writing: {
        feedbackRevision: 0,
        generationRevision: 0,
        sourceFingerprint: 'github@1',
        status: 'failed',
      },
    });
    expect(harness.repository.prepareWriting).not.toHaveBeenCalled();
    expect(harness.repository.failWriting).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackRevision: 0,
        generationRevision: 0,
        sourceFingerprint: 'github@1',
      }),
    );
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
          responseLanguage: 'zh-CN',
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
      expect(harness.generateObject).not.toHaveBeenCalled();
    },
  );

  it('reuses a valid stored writer result without another model request', async () => {
    const fingerprint = 'github@1';
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.stored.set('github:1', storedContext('github', '# GitHub'));
    harness.setLatestAssistant({
      content: JSON.stringify(analysis),
      id: 'assistant-existing',
      role: 'assistant',
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: fingerprint,
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-existing' });
    expect(harness.generateObject).not.toHaveBeenCalled();
    expect(harness.messages.create).not.toHaveBeenCalled();
    expect(harness.repository.commitWriting).toHaveBeenCalledOnce();
  });
});
