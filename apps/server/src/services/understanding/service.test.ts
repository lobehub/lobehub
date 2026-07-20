import { StaleUnderstandingRevisionError } from '@lobechat/database';
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
import { UnderstandingProviderRetryableError } from './types';

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
  let threadAssistant:
    | { content?: unknown; error?: unknown; id: string; role: string; threadId?: string | null }
    | undefined;
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
      findLatestAssistantMessageByThread: vi.fn(async () => threadAssistant),
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
    setThreadAssistant: (value: typeof threadAssistant) => (threadAssistant = value),
    sourceStore,
    stored,
  };
};

describe('UnderstandingService public workflow commands', () => {
  beforeEach(() => {
    mockAssertWorkflowAvailable.mockReset();
    mockTriggerProviders.mockReset();
  });

  it('checks workflow availability before creating durable state', async () => {
    const harness = createHarness(null);
    mockAssertWorkflowAvailable.mockImplementationOnce(() => {
      throw new Error('workflow unavailable');
    });

    await expect(harness.service.start('topic-1')).rejects.toThrow('workflow unavailable');
    expect(harness.repository.initialize).not.toHaveBeenCalled();
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

  it('replays delivery from existing provider revisions without reinitializing', async () => {
    mockTriggerProviders.mockRejectedValueOnce(new Error('delivery uncertain'));
    const harness = createHarness(
      createSession({
        github: providerState('pending', 2),
        gmail: providerState('running', 4),
      }),
    );

    await expect(harness.service.start('topic-1')).rejects.toThrow('delivery uncertain');
    await harness.service.start('topic-1');

    expect(harness.repository.initialize).not.toHaveBeenCalled();
    expect(mockTriggerProviders).toHaveBeenCalledTimes(2);
    expect(mockTriggerProviders).toHaveBeenLastCalledWith(
      expect.objectContaining({
        providers: [
          { id: 'github', revision: 3 },
          { id: 'gmail', revision: 4 },
        ],
      }),
      { workflowRunId: 'onboarding-understanding-initial-session-1' },
    );
  });

  it('prepares a failed provider and triggers only that provider', async () => {
    mockTriggerProviders.mockResolvedValueOnce({ workflowRunId: 'workflow-1' });
    const harness = createHarness(createSession({ github: providerState('failed', 3) }));
    harness.repository.markProviderRunning.mockResolvedValueOnce({ claimed: true, revision: 4 });

    await harness.service.retry({
      providerId: 'github',
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(mockTriggerProviders).toHaveBeenCalledWith(
      {
        providers: [{ id: 'github', revision: 4 }],
        sessionId: 'session-1',
        topicId: 'topic-1',
        userId: 'user-1',
      },
      { workflowRunId: 'onboarding-understanding-retry-session-1-github-4' },
    );
  });

  it('rejects retrying a provider that is already running', async () => {
    const harness = createHarness(createSession({ github: providerState('running', 4) }));

    await expect(
      harness.service.retry({
        providerId: 'github',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).rejects.toThrow();

    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
    expect(mockTriggerProviders).not.toHaveBeenCalled();
  });

  it('returns a failed retry revision after trigger delivery fails so it can be retried', async () => {
    const triggerError = new Error('delivery failed');
    mockTriggerProviders
      .mockRejectedValueOnce(triggerError)
      .mockResolvedValueOnce({ workflowRunId: 'workflow-2' });
    const harness = createHarness(createSession({ github: providerState('failed', 3) }));
    harness.repository.markProviderRunning
      .mockImplementationOnce(async () => {
        harness.setSession(createSession({ github: providerState('running', 4) }));
        return { claimed: true, revision: 4 };
      })
      .mockImplementationOnce(async () => {
        harness.setSession(createSession({ github: providerState('running', 5) }));
        return { claimed: true, revision: 5 };
      });
    harness.repository.failProvider.mockImplementationOnce(async () => {
      const failed = createSession({ github: providerState('failed', 4) });
      harness.setSession(failed);
      return failed;
    });
    const input = { providerId: 'github', sessionId: 'session-1', topicId: 'topic-1' };

    await expect(harness.service.retry(input)).rejects.toBe(triggerError);
    expect(harness.repository.failProvider).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'github', revision: 4 }),
    );
    await expect(harness.service.retry(input)).resolves.toMatchObject({ id: 'session-1' });
    expect(mockTriggerProviders).toHaveBeenLastCalledWith(
      expect.objectContaining({ providers: [{ id: 'github', revision: 5 }] }),
      { workflowRunId: 'onboarding-understanding-retry-session-1-github-5' },
    );
    await expect(harness.service.processProvider({ ...input, revision: 4 })).resolves.toMatchObject(
      { revision: 4, status: 'stale' },
    );
    harness.repository.failProvider.mockRejectedValueOnce(
      new StaleUnderstandingRevisionError('github', 4),
    );
    await expect(harness.service.failProvider({ ...input, revision: 4 })).resolves.toBeUndefined();
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

  it('resumes a running provider and returns the canonical completed fingerprint', async () => {
    const harness = createHarness(
      createSession({
        github: providerState('running', 1),
        gmail: providerState('completed', 1),
      }),
    );
    harness.stored.set('gmail', context('gmail', '<gmail/>'));
    harness.repository.completeProvider.mockImplementationOnce(async () => {
      const completed = createSession({
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      });
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
    ).resolves.toMatchObject({
      providerId: 'github',
      revision: 1,
      sourceFingerprint: 'github@1,gmail@1',
      status: 'completed',
    });
    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
    expect(harness.collect).toHaveBeenCalledOnce();
  });

  it('recovers a completed provider from its revision-matching Redis context without recollecting', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 2) }));
    harness.stored.set('github', context('github', '# Existing profile', 2));

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 2,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({
      failedCount: 0,
      providerId: 'github',
      revision: 2,
      sourceCount: 3,
      sourceFingerprint: 'github@2',
      status: 'completed',
      succeededCount: 2,
    });
    expect(harness.collect).not.toHaveBeenCalled();
    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
  });

  it('keeps a failed provider terminal until an explicit retry command', async () => {
    const harness = createHarness(createSession({ github: providerState('failed', 3) }));

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 3,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ providerId: 'github', revision: 3, status: 'failed' });
    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
    expect(harness.collect).not.toHaveBeenCalled();
  });

  it('does not let an older accepted attempt process a newer running revision', async () => {
    const harness = createHarness(createSession({ github: providerState('running', 5) }));

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 4,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({
      failedCount: 0,
      providerId: 'github',
      revision: 4,
      sourceCount: 0,
      status: 'stale',
      succeededCount: 0,
    });
    expect(harness.collect).not.toHaveBeenCalled();
    expect(harness.repository.markProviderRunning).not.toHaveBeenCalled();
  });

  it('stores raw context but returns only bounded collection state', async () => {
    const { service, sourceStore, stored } = createHarness(
      createSession({ github: providerState('running') }),
    );

    const result = await service.processProvider({
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(result).toEqual({
      failedCount: 0,
      providerId: 'github',
      revision: 1,
      sourceCount: 3,
      sourceFingerprint: 'github@1',
      status: 'completed',
      succeededCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_GITHUB_CONTEXT');
    expect(sourceStore.put).toHaveBeenCalledOnce();
    expect(stored.get('github')?.context).toContain('PRIVATE_GITHUB_CONTEXT');
  });

  it('marks a bounded permanent empty result failed', async () => {
    const harness = createHarness(createSession({ github: providerState('running') }));
    harness.providers.set('github', {
      collect: vi.fn(async () => ({
        context: '',
        diagnostics: {
          errors: [
            {
              code: 'UNDERSTANDING_PROVIDER_AUTHORIZATION_FAILED',
              message: 'github authorize failed',
              operation: 'authorize',
              provider: 'github',
              retryable: false,
            },
          ],
          evidenceCount: 0,
          failedCount: 1,
          succeededCount: 0,
        },
        sourceCount: 0,
      })),
      id: 'github',
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ providerId: 'github', status: 'failed' });
    expect(harness.repository.failProvider).toHaveBeenCalledOnce();
    expect(harness.sourceStore.put).not.toHaveBeenCalled();
  });

  it('completes usable partial collection while retaining bounded diagnostics', async () => {
    const harness = createHarness(createSession({ github: providerState('running') }));
    harness.providers.set('github', {
      collect: vi.fn(async () => ({
        context: '# Partial profile',
        diagnostics: {
          errors: [
            {
              code: 'GITHUB_ORGANIZATIONS_FAILED',
              message: 'untrusted detail',
              operation: 'untrusted operation',
              provider: 'untrusted provider',
              retryable: false,
            },
          ],
          evidenceCount: 2,
          failedCount: 1,
          succeededCount: 2,
        },
        sourceCount: 2,
      })),
      id: 'github',
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ failedCount: 1, status: 'completed', succeededCount: 2 });
    expect(harness.repository.completeProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: [expect.objectContaining({ provider: 'github' })],
      }),
    );
  });

  it('keeps the first Redis context authoritative when database completion is retried', async () => {
    const harness = createHarness(createSession({ github: providerState('running') }));
    const first = {
      context: '# First profile',
      diagnostics: { ...diagnostics, evidenceCount: 5, succeededCount: 4 },
      sourceCount: 5,
    };
    const second = {
      context: '# Different retry profile',
      diagnostics: { ...diagnostics, evidenceCount: 2, succeededCount: 1 },
      sourceCount: 2,
    };
    harness.collect.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    harness.sourceStore.put.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    harness.sourceStore.get.mockResolvedValueOnce({
      ...first,
      providerId: 'github',
      revision: 1,
    });
    harness.repository.completeProvider.mockRejectedValueOnce(new Error('database unavailable'));

    const input = {
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      topicId: 'topic-1',
    };
    await expect(harness.service.processProvider(input)).rejects.toThrow('database unavailable');
    await expect(harness.service.processProvider(input)).resolves.toMatchObject({
      sourceCount: 5,
      succeededCount: 4,
    });
    expect(harness.repository.completeProvider).toHaveBeenLastCalledWith(
      expect.objectContaining({ succeededCount: 4 }),
    );
  });

  it('rethrows transient provider failures without changing durable state', async () => {
    const harness = createHarness(createSession({ github: providerState('running') }));
    harness.providers.set('github', {
      collect: vi.fn(async () => {
        throw new UnderstandingProviderRetryableError();
      }),
      id: 'github',
    });

    await expect(
      harness.service.processProvider({
        providerId: 'github',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).rejects.toBeInstanceOf(UnderstandingProviderRetryableError);
    expect(harness.repository.completeProvider).not.toHaveBeenCalled();
    expect(harness.repository.failProvider).not.toHaveBeenCalled();
  });
});

describe('UnderstandingService persona writing', () => {
  it('claims an unseen fingerprint before writing it', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.stored.set('github', context('github', '# GitHub'));
    harness.repository.claimWriting.mockImplementationOnce(async () => {
      harness.setSession({
        id: 'session-1',
        sources: { github: providerState('completed', 1) },
        writing: {
          sourceFingerprint: 'github@1',
          status: 'running',
          updatedAt: '2026-07-20T00:00:00.000Z',
        },
      });
      return { claimed: true };
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, sourceFingerprint: 'github@1' });
    expect(harness.repository.claimWriting).toHaveBeenCalledOnce();
    expect(harness.repository.claimWriting).toHaveBeenCalledBefore(
      vi.mocked(harness.dependencies.sourceStore),
    );
    expect(harness.execAgent).toHaveBeenCalledOnce();
  });

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

  it('reports a delayed writing failure callback as a no-op', async () => {
    const current = {
      id: 'session-1',
      sources: {
        github: providerState('completed', 1),
        gmail: providerState('completed', 1),
      },
      writing: {
        sourceFingerprint: 'github@1,gmail@1',
        status: 'running' as const,
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    };
    const harness = createHarness(current);
    harness.repository.failWriting.mockResolvedValueOnce(current);

    await expect(
      harness.service.failWriting({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        topicId: 'topic-1',
      }),
    ).resolves.toBeUndefined();
  });

  it('recovers an already completed fingerprint without launching another writer', async () => {
    const harness = createHarness({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        resultMessageId: 'assistant-existing',
        sourceFingerprint: 'github@1',
        status: 'completed',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({
      published: true,
      resultId: 'assistant-existing',
      sourceFingerprint: 'github@1',
    });
    expect(harness.repository.claimWriting).not.toHaveBeenCalled();
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

  it('recovers only the exact fingerprint thread without launching another agent', async () => {
    const harness = createHarness({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        sourceFingerprint: 'github@1',
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('github', context('github', '# Profile'));
    harness.repository.ensureWritingThread.mockImplementationOnce(async ({ threadId }) => {
      vi.mocked(harness.dependencies.topic.findById).mockResolvedValueOnce({
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-recovered',
            operationId: 'operation-recovered',
            threadId,
          },
        },
      });
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-recovered' });

    expect(harness.execAgent).not.toHaveBeenCalled();
    expect(harness.executeOperation).toHaveBeenCalledWith('operation-recovered');
    expect(harness.dependencies.messages.findById).toHaveBeenCalledWith('assistant-recovered');
    expect(harness.dependencies.messages.findLatestAssistantMessageByThread).not.toHaveBeenCalled();
  });

  it('reuses a completed assistant from the exact thread after runningOperation is cleared', async () => {
    const harness = createHarness({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        sourceFingerprint: 'github@1',
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('github', context('github', '# Profile'));
    harness.setThreadAssistant({
      content: JSON.stringify(analysis),
      id: 'assistant-completed',
      role: 'assistant',
      threadId: 'exact-thread-selected-by-query',
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-completed' });

    expect(harness.execAgent).not.toHaveBeenCalled();
    expect(harness.executeOperation).not.toHaveBeenCalled();
    expect(harness.repository.commitWriting).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMessageId: 'assistant-completed' }),
    );
  });

  it('replaces an invalid existing assistant in the same deterministic thread', async () => {
    const harness = createHarness({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        sourceFingerprint: 'github@1',
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    harness.stored.set('github', context('github', '# Profile'));
    harness.setThreadAssistant({
      content: '{"profile":{"name":"Neko"},"composition":{}}',
      id: 'assistant-invalid',
      role: 'assistant',
      threadId: 'exact-thread-selected-by-query',
    });

    await expect(
      harness.service.processCollected({
        expectedSourceFingerprint: 'github@1',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-1' });
    expect(harness.execAgent).toHaveBeenCalledOnce();
    const queriedThread = vi.mocked(
      harness.dependencies.messages.findLatestAssistantMessageByThread,
    ).mock.calls[0][0].threadId;
    expect(harness.execAgent).toHaveBeenCalledWith(
      expect.objectContaining({ appContext: { threadId: queriedThread, topicId: 'topic-1' } }),
    );
    expect(harness.repository.commitWriting).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMessageId: 'assistant-1' }),
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
