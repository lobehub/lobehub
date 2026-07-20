import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_AGENT_INPUT_LENGTH } from './sanitizer';
import {
  createUnderstandingService,
  UnderstandingService,
  type UnderstandingServiceDependencies,
} from './service';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import type { UnderstandingProvider } from './types';

const { factoryMocks, mockAssertWorkflowAvailable, mockTriggerProviders } = vi.hoisted(() => ({
  factoryMocks: {
    execAgent: vi.fn(),
    executeSync: vi.fn(),
    messageContent: '',
    session: undefined as OnboardingUnderstandingSession | undefined,
  },
  mockAssertWorkflowAvailable: vi.fn(),
  mockTriggerProviders: vi.fn(),
}));

vi.mock('@lobechat/database', async () => {
  const { getUnderstandingSourceFingerprint } =
    await import('../../../../../packages/database/src/repositories/onboardingUnderstanding/fingerprint');
  class DomainError extends Error {}
  return {
    getUnderstandingSourceFingerprint,
    OnboardingUnderstandingRepository: class {
      claimWriting = vi.fn();
      commitWriting = vi.fn(async () => ({ published: true }));
      ensureWritingThread = vi.fn();
      get = vi.fn(async () => factoryMocks.session);
    },
    StaleUnderstandingRevisionError: DomainError,
    StaleUnderstandingSessionError: DomainError,
    UnderstandingPreconditionError: DomainError,
    UnderstandingResourceNotFoundError: DomainError,
    UnderstandingSessionNotFoundError: DomainError,
  };
});
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    getBuiltinAgent = vi.fn(async () => ({ id: 'agent-1' }));
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = vi.fn(async () => ({ content: factoryMocks.messageContent }));
    findLatestAssistantMessageByThread = vi.fn(async () => null);
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = vi.fn(async () => ({ metadata: { onboardingSession: {} } }));
  },
}));
vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: class {
    getLatestPersonaDocument = vi.fn(async () => null);
  },
}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: class {
    executeSync = factoryMocks.executeSync;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = factoryMocks.execAgent;
  },
}));
vi.mock('@/server/workflows/onboardingUnderstanding', () => ({
  OnboardingUnderstandingWorkflow: {
    assertAvailable: mockAssertWorkflowAvailable,
    triggerProviders: mockTriggerProviders,
  },
}));
vi.mock('./providers', () => ({
  builtinUnderstandingProviderRegistrations: [],
  materializeUnderstandingProviders: vi.fn(() => ({
    registry: { get: vi.fn(), list: vi.fn(() => []) },
  })),
}));
vi.mock('./sourceStore', () => ({
  UnderstandingSourceStore: class {
    get = vi.fn(async () => ({
      context: '# GitHub',
      diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
      providerId: 'github',
      revision: 1,
      sourceCount: 1,
    }));
  },
}));

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [],
    interests: [{ description: 'Builds agent systems.', salience: 96, title: 'Agents' }],
    lifeStyle: [],
    social: [],
    working: [],
  },
  personaProposal: {
    content: 'You build agent systems.',
    reasoning: 'The connected sources repeatedly show agent infrastructure work.',
    tagline: 'Agent infrastructure builder',
  },
  profile: {
    description: 'Engineer building agent infrastructure.',
    domains: ['AI infrastructure'],
    name: 'Neko',
    pronoun: 'she/her',
    roles: ['engineer'],
    summary: 'Builds open source agent systems.',
    tagline: 'AI infrastructure engineer',
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

const context = (
  providerId: string,
  value: string,
  revision = 1,
): StoredUnderstandingProviderContext => ({
  context: value,
  diagnostics,
  providerId,
  revision,
  sourceCount: 3,
});

describe('createUnderstandingService', () => {
  it('lets the Agent Runtime finish without an outer step cap', async () => {
    factoryMocks.session = {
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        sourceFingerprint: 'github@1',
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    };
    factoryMocks.messageContent = JSON.stringify(analysis);
    factoryMocks.execAgent.mockResolvedValueOnce({
      assistantMessageId: 'assistant-1',
      operationId: 'operation-1',
      success: true,
    });
    factoryMocks.executeSync.mockResolvedValueOnce({ status: 'done' });
    const service = await createUnderstandingService({ db: {} as never, userId: 'user-1' });

    await service.processCollected({
      expectedSourceFingerprint: 'github@1',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(factoryMocks.executeSync).toHaveBeenCalledWith('operation-1');
  });
});

const createHarness = (initialSession: OnboardingUnderstandingSession | null = createSession()) => {
  let session = initialSession ?? undefined;
  const stored = new Map<string, StoredUnderstandingProviderContext>();
  const providers = new Map<string, UnderstandingProvider>();
  const assistantMetadata = new Map<string, OnboardingUnderstandingMessageMetadata>();
  const collect = vi.fn(async () => ({
    context: '# GitHub\n\nPRIVATE_GITHUB_CONTEXT',
    diagnostics,
    sourceCount: 3,
  }));
  providers.set('github', { collect, id: 'github' });
  providers.set('gmail', {
    collect: vi.fn(async () => ({
      context: '<gmail>PRIVATE_GMAIL_CONTEXT</gmail>',
      diagnostics,
      sourceCount: 3,
    })),
    id: 'gmail',
  });

  const execAgent = vi.fn(async (_input: Record<string, unknown>) => ({
    assistantMessageId: 'assistant-1',
    autoStarted: false,
    operationId: 'operation-1',
    success: true as const,
  }));
  const executeOperation = vi.fn(async () => ({ status: 'done' }));
  const repository = {
    claimWriting: vi.fn(async ({ threadId }: { threadId: string }) => ({
      claimed: true,
      threadId,
    })),
    commitWriting: vi.fn(async (): Promise<{ personaVersion?: number; published: boolean }> => ({
      published: true,
    })),
    ensureWritingThread: vi.fn(async () => undefined),
    expireProviderContexts: vi.fn(async () => session!),
    completeProvider: vi.fn(
      async ({ providerId, revision }: { providerId: string; revision: number }) => {
        session = {
          ...session!,
          sources: {
            ...session!.sources,
            [providerId]: providerState('completed', revision),
          },
        };
        return session;
      },
    ),
    confirm: vi.fn(async () => ({ personaVersion: 1 })),
    failProvider: vi.fn(async () => session!),
    failWriting: vi.fn(async () => session),
    get: vi.fn(async () => session),
    initialize: vi.fn(async (_topicId: string, sessionId: string, providerIds: string[]) => {
      session = {
        id: sessionId,
        sources: Object.fromEntries(providerIds.map((id) => [id, providerState('pending')])),
      } as OnboardingUnderstandingSession;
      return session;
    }),
    markProviderRunning: vi.fn(async () => ({ claimed: true, revision: 1 })),
  };
  const sourceStore = {
    deleteSession: vi.fn(),
    get: vi.fn(async ({ providerId, revision }: { providerId: string; revision: number }) => {
      const item = stored.get(providerId);
      return item?.revision === revision ? item : null;
    }),
    list: vi.fn(async () => [...stored.values()]),
    put: vi.fn(async (item: StoredUnderstandingProviderContext) => {
      stored.set(item.providerId, item);
      return true;
    }),
  };
  const dependencies: UnderstandingServiceDependencies = {
    ids: () => 'session-new',
    messages: {
      findById: vi.fn(async (id) => ({
        content: JSON.stringify(analysis),
        metadata: assistantMetadata.has(id)
          ? { onboardingUnderstanding: assistantMetadata.get(id) }
          : undefined,
      })),
      findLatestAssistantMessageByThread: vi.fn(async () => undefined),
    },
    persona: {
      getLatestPersonaDocument: vi.fn(async () => null),
    },
    providers: {
      get: (id) => providers.get(id),
      list: () => [...providers.values()],
    },
    repository,
    sourceStore: vi.fn(async () => sourceStore),
    topic: {
      assertActiveOnboardingTopic: vi.fn(),
      findById: vi.fn(async () => ({ metadata: {} })),
    },
    userId: 'user-1',
    writerAgentId: vi.fn(async () => 'agent-1'),
    writerRuntime: vi.fn(async () => ({
      agent: { execAgent },
      executeOperation,
    })),
  };
  return {
    assistantMetadata,
    collect,
    dependencies,
    execAgent,
    executeOperation,
    providers,
    repository,
    service: new UnderstandingService(dependencies),
    setSession: (value: OnboardingUnderstandingSession) => (session = value),
    sourceStore,
    stored,
  };
};

describe('UnderstandingService public workflow commands', () => {
  beforeEach(() => {
    mockAssertWorkflowAvailable.mockReset();
    mockTriggerProviders.mockReset();
  });

  it('initializes all providers and triggers the provider workflow with safe identifiers', async () => {
    mockTriggerProviders.mockResolvedValueOnce({ workflowRunId: 'workflow-1' });
    const harness = createHarness(null);

    const result = await harness.service.start('topic-1');

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
    expect(result).toMatchObject({ id: 'session-new', status: 'processing' });
    expect(JSON.stringify(mockTriggerProviders.mock.calls.at(-1))).not.toContain('PRIVATE_');
  });
});

describe('UnderstandingService provider collection', () => {
  it('claims a pending revision before collecting it', async () => {
    const harness = createHarness(createSession({ github: providerState('pending', 0) }));
    harness.repository.markProviderRunning.mockImplementationOnce(async () => {
      harness.setSession(createSession({ github: providerState('running', 1) }));
      return { claimed: true, revision: 1 };
    });
    harness.repository.completeProvider.mockImplementationOnce(async () => {
      const completed = createSession({ github: providerState('completed', 1) });
      harness.setSession(completed);
      return completed;
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ sourceFingerprint: 'github@1', status: 'completed' });
    expect(harness.repository.markProviderRunning).toHaveBeenCalledWith(
      'topic-1',
      'session-1',
      'github',
      { revision: 0, status: 'pending' },
    );
  });

  it('returns the fingerprint from its own completion when another provider wins the race', async () => {
    const harness = createHarness(
      createSession({
        github: providerState('running', 1),
        gmail: providerState('running', 1),
      }),
    );
    harness.repository.completeProvider.mockImplementationOnce(async () => {
      const githubCompletion = createSession({
        github: providerState('completed', 1),
        gmail: providerState('running', 1),
      });
      harness.setSession(
        createSession({
          github: providerState('completed', 1),
          gmail: providerState('completed', 1),
        }),
      );
      return githubCompletion;
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ sourceFingerprint: 'github@1', status: 'completed' });
  });
});

describe('UnderstandingService persona writing', () => {

  it('does not let a delayed child claim a newer combined provider fingerprint', async () => {
    const harness = createHarness({
      id: 'session-1',
      sources: {
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      },
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({ published: false, sourceFingerprint: 'github@1' });
    expect(harness.repository.claimWriting).not.toHaveBeenCalled();
    expect(harness.execAgent).not.toHaveBeenCalled();
  });

  it('expires missing completed contexts and returns without launching the writer', async () => {
    const fingerprint = 'github@1,gmail@1';
    const harness = createHarness({
      id: 'session-1',
      sources: {
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      },
      writing: {
        sourceFingerprint: fingerprint,
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('gmail', context('gmail', '<gmail/>'));

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: fingerprint,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({ published: false, sourceFingerprint: fingerprint });
    expect(harness.repository.expireProviderContexts).toHaveBeenCalledWith({
      providers: [{ providerId: 'github', revision: 1 }],
      sessionId: 'session-1',
      sourceFingerprint: fingerprint,
      topicId: 'topic-1',
    });
    expect(harness.execAgent).not.toHaveBeenCalled();
  });

  it('writes a stable multi-provider ephemeral document from raw contexts and baseline only', async () => {
    const fingerprint = 'github@1,gmail@1';
    const harness = createHarness({
      id: 'session-1',
      sources: {
        calendar: {
          errors: [
            {
              code: 'PROVIDER_COLLECTION_FAILED',
              message: 'calendar collection failed',
              operation: 'collection',
              provider: 'calendar',
              retryable: false,
            },
          ],
          failedCount: 1,
          revision: 1,
          status: 'failed',
          succeededCount: 0,
        },
        gmail: providerState('completed', 1),
        github: providerState('completed', 1),
      },
      writing: {
        resultMessageId: 'assistant-old',
        sourceFingerprint: fingerprint,
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('gmail', context('gmail', '<gmail>MAIL_CONTEXT</gmail>'));
    harness.stored.set('github', context('github', '# GitHub\n\nGITHUB_CONTEXT'));
    harness.assistantMetadata.set('assistant-old', {
      analysis: {
        ...analysis,
        personaProposal: { ...analysis.personaProposal, content: 'EARLIER_PROPOSAL_TEXT' },
      },
      diagnostics,
      kind: 'proposal',
      providers: ['github'],
      resultId: 'assistant-old',
      sourceFingerprint: 'github@1',
    });
    vi.mocked(harness.dependencies.persona.getLatestPersonaDocument).mockResolvedValueOnce({
      persona: 'CURRENT_PERSONA_BASELINE',
      tagline: 'Current tagline',
    });
    const result = await harness.service.processCollected({
      expectedSourceFingerprint: fingerprint,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(result).toMatchObject({ published: true, resultId: 'assistant-1' });
    const call = harness.execAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      appContext: { threadId: expect.stringMatching(/^thd_[a-f\d]{24}$/), topicId: 'topic-1' },
      autoStart: false,
      slug: 'onboarding-understanding',
      suppressUserMessage: true,
    });
    expect(call.ephemeralUserMessage).toContain('CURRENT_PERSONA_BASELINE');
    expect(call.ephemeralUserMessage).toContain('provider="github" revision="1">\n# GitHub');
    expect(call.ephemeralUserMessage).toContain(
      'provider="gmail" revision="1">\n<gmail>MAIL_CONTEXT</gmail>',
    );
    expect(call.ephemeralUserMessage.indexOf('provider="github"')).toBeLessThan(
      call.ephemeralUserMessage.indexOf('provider="gmail"'),
    );
    expect(call.ephemeralUserMessage).not.toContain('EARLIER_PROPOSAL_TEXT');
    expect(call.instructions).toContain('4 of 5 collection operations succeeded');
    expect(harness.dependencies.messages.findById).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.messages.findById).toHaveBeenCalledWith('assistant-1');
    expect(harness.executeOperation).toHaveBeenCalledWith('operation-1');
    expect(harness.repository.commitWriting).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantMessageId: 'assistant-1',
        metadata: expect.objectContaining({
          kind: 'proposal',
          providers: ['github', 'gmail'],
          sourceFingerprint: fingerprint,
        }),
      }),
    );
  });

  it('preserves every closing provider boundary within the input budget', async () => {
    const fingerprint = 'github@1,gmail@1';
    const harness = createHarness({
      id: 'session-1',
      sources: {
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      },
      writing: {
        sourceFingerprint: fingerprint,
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('github', context('github', `github:${'A'.repeat(64_000)}`));
    harness.stored.set('gmail', context('gmail', `gmail:${'B'.repeat(64_000)}`));
    await harness.service.processCollected({
      expectedSourceFingerprint: fingerprint,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    const document = harness.execAgent.mock.calls[0][0].ephemeralUserMessage as string;
    expect(document.length).toBeLessThanOrEqual(MAX_AGENT_INPUT_LENGTH);
    expect(document.match(/<\/provider-context>/g)).toHaveLength(2);
    expect(document).toContain('github:A');
    expect(document).toContain('gmail:B');
    expect(document.endsWith('</provider-context>')).toBe(true);
  });
});

describe('UnderstandingService polling', () => {
  it('polls the current proposal metadata without reconciliation writes', async () => {
    const proposal: OnboardingUnderstandingMessageMetadata = {
      analysis,
      diagnostics,
      kind: 'proposal',
      providers: ['github'],
      resultId: 'result-1',
      sourceFingerprint: 'github@1',
    };
    const harness = createHarness({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        resultMessageId: 'assistant-1',
        sourceFingerprint: 'github@1',
        status: 'completed',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.assistantMetadata.set('assistant-1', proposal);

    await expect(harness.service.get('topic-1')).resolves.toEqual({
      id: 'session-1',
      proposal,
      sources: { github: providerState('completed', 1) },
      status: 'completed',
      writing: expect.objectContaining({ resultMessageId: 'assistant-1' }),
    });
    expect(harness.repository.commitWriting).not.toHaveBeenCalled();
    expect(harness.dependencies.writerAgentId).not.toHaveBeenCalled();
  });
});
