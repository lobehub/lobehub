import type {
  CollectionDiagnostics,
  OnboardingUnderstandingMessageMetadata,
  OnboardingUnderstandingSession,
  UnderstandingAnalysis,
} from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { MAX_AGENT_INPUT_LENGTH } from './sanitizer';
import {
  createUnderstandingService,
  UnderstandingService,
  type UnderstandingServiceDependencies,
} from './service';
import type { StoredUnderstandingProviderContext } from './sourceStore';
import type { UnderstandingProvider } from './types';
import { UnderstandingProviderRetryableError } from './types';

const factoryMocks = vi.hoisted(() => ({
  agentRuntimeConstructor: vi.fn(),
  writingClaimed: false,
  sourceContext: {
    context: '# Factory context',
    diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
    providerId: 'github',
    revision: 1,
    sourceCount: 1,
  },
}));

vi.mock('@lobechat/database', () => {
  class DomainError extends Error {}
  return {
    getUnderstandingSourceFingerprint: (session: OnboardingUnderstandingSession) =>
      Object.entries(session.sources)
        .filter(([, source]) => source.status === 'completed')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([providerId, source]) => `${providerId}@${source.revision}`)
        .join(','),
    OnboardingUnderstandingRepository: class {
      claimWriting = vi.fn(
        async ({ threadId }: { sourceFingerprint: string; threadId: string }) => {
          factoryMocks.writingClaimed = true;
          return { claimed: true, threadId };
        },
      );
      commitWriting = vi.fn(async () => ({ published: true }));
      get = vi.fn(async () => ({
        id: 'session-factory',
        sources: {
          github: {
            errors: [],
            failedCount: 0,
            revision: 1,
            status: 'completed',
            succeededCount: 1,
          },
        },
        ...(factoryMocks.writingClaimed
          ? {
              writing: {
                sourceFingerprint: 'github@1',
                status: 'running',
                updatedAt: '2026-07-20T00:00:00.000Z',
              },
            }
          : {}),
      }));
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
    getBuiltinAgent = vi.fn(async () => ({ id: 'agent-factory' }));
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = vi.fn(async () => ({ content: JSON.stringify(analysis) }));
    findLatestAssistantMessageByThread = vi.fn(async () => undefined);
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
    executeSync = vi.fn(async () => ({ status: 'done' }));

    constructor(...args: unknown[]) {
      factoryMocks.agentRuntimeConstructor(...args);
    }
  },
}));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = vi.fn(async () => ({
      assistantMessageId: 'assistant-factory',
      operationId: 'operation-factory',
      success: true,
    }));
  },
}));
vi.mock('./providers', () => ({
  builtinUnderstandingProviderRegistrations: [{ id: 'github' }],
  materializeUnderstandingProviders: vi.fn(() => ({
    registry: {
      get: () => ({ id: 'github' }),
      list: () => [{ id: 'github' }],
    },
  })),
}));
vi.mock('./sourceStore', () => ({
  UnderstandingSourceStore: class {
    get = vi.fn(async () => factoryMocks.sourceContext);
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
    completeProvider: vi.fn(async (input: any) => {
      session = {
        ...session,
        sources: {
          ...session.sources,
          [input.providerId]: {
            completedAt: '2026-07-20T00:00:00.000Z',
            errors: input.errors,
            failedCount: input.failedCount,
            revision: input.revision,
            status: 'completed',
            succeededCount: input.succeededCount,
          },
        },
      };
      return session;
    }),
    confirm: vi.fn(async () => ({ personaVersion: 1 })),
    failProvider: vi.fn(async (input: any) => {
      session = {
        ...session,
        sources: {
          ...session.sources,
          [input.providerId]: {
            completedAt: '2026-07-20T00:00:00.000Z',
            errors: input.errors,
            failedCount: input.failedCount,
            revision: input.revision,
            status: 'failed',
            succeededCount: input.succeededCount,
          },
        },
      };
      return session;
    }),
    failWriting: vi.fn(async () => session),
    get: vi.fn(async () => session),
    initialize: vi.fn(async (_topicId: string, sessionId: string, providerIds: string[]) => {
      session = {
        id: sessionId,
        sources: Object.fromEntries(providerIds.map((id) => [id, providerState('pending')])),
      };
      return session;
    }),
    markProviderRunning: vi.fn(async (_topicId: string, _sessionId: string, providerId: string) => {
      const revision = session!.sources[providerId].revision + 1;
      session = {
        ...session!,
        sources: {
          ...session!.sources,
          [providerId]: { ...providerState('running', revision) },
        },
      };
      return { claimed: true, revision };
    }),
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
    writerAgentId: 'agent-1',
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

describe('UnderstandingService provider collection', () => {
  it('claims a registered pending provider without exposing connector identity', async () => {
    const { service } = createHarness();

    await expect(
      service.claimProvider({ providerId: 'github', sessionId: 'session-1', topicId: 'topic-1' }),
    ).resolves.toEqual({ claimed: true, providerId: 'github', revision: 1 });
  });

  it('stores raw context but returns only bounded collection state', async () => {
    const { service, sourceStore, stored } = createHarness(
      createSession({ github: providerState('running') }),
    );

    const result = await service.collectProvider({
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
      harness.service.collectProvider({
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
      harness.service.collectProvider({
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

  it('rethrows transient provider failures without changing durable state', async () => {
    const harness = createHarness(createSession({ github: providerState('running') }));
    harness.providers.set('github', {
      collect: vi.fn(async () => {
        throw new UnderstandingProviderRetryableError();
      }),
      id: 'github',
    });

    await expect(
      harness.service.collectProvider({
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
  it('persists the writing claim before Redis or runtime initialization can fail', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    vi.mocked(harness.dependencies.sourceStore).mockRejectedValueOnce(
      new Error('Redis unavailable'),
    );
    vi.mocked(harness.dependencies.writerRuntime).mockRejectedValueOnce(
      new Error('Runtime unavailable'),
    );

    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(harness.repository.claimWriting).toHaveBeenCalledOnce();
    expect(harness.dependencies.sourceStore).not.toHaveBeenCalled();
    expect(harness.dependencies.writerRuntime).not.toHaveBeenCalled();

    harness.setSession({
      id: 'session-1',
      sources: { github: providerState('completed', 1) },
      writing: {
        sourceFingerprint: claim.sourceFingerprint,
        status: 'running',
        updatedAt: '2026-07-20T00:00:00.000Z',
      },
    });
    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: claim.sourceFingerprint,
        threadId: claim.threadId,
        topicId: 'topic-1',
      }),
    ).rejects.toThrow('Redis unavailable');
    harness.stored.set('github', context('github', '# Profile'));
    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: claim.sourceFingerprint,
        threadId: claim.threadId,
        topicId: 'topic-1',
      }),
    ).rejects.toThrow('Runtime unavailable');
    await harness.service.failWriting({
      sessionId: 'session-1',
      sourceFingerprint: claim.sourceFingerprint,
      topicId: 'topic-1',
    });
    expect(harness.repository.failWriting).toHaveBeenCalledOnce();
  });

  it('claims deterministic independent threads without loading provider contexts', async () => {
    const harness = createHarness(createSession({ github: providerState('completed', 1) }));
    harness.stored.set('github', context('github', '# Profile', 1));

    const first = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    const replay = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    harness.setSession(createSession({ github: providerState('completed', 2) }));
    harness.stored.set('github', context('github', '# Updated profile', 2));
    const updated = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    expect(first).toEqual(replay);
    expect(first.threadId).not.toBe(updated.threadId);
    expect(first.sourceFingerprint).toBe('github@1');
    expect(updated.sourceFingerprint).toBe('github@2');
    expect(harness.dependencies.sourceStore).not.toHaveBeenCalled();
    expect(harness.dependencies.writerRuntime).not.toHaveBeenCalled();
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    harness.setSession({
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

    const result = await harness.service.writeCollected({
      sessionId: 'session-1',
      sourceFingerprint: fingerprint,
      threadId: claim.threadId,
      topicId: 'topic-1',
    });

    expect(result).toMatchObject({ published: true, resultId: 'assistant-1' });
    const call = harness.execAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      appContext: { threadId: claim.threadId, topicId: 'topic-1' },
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

  it('treats a stale CAS commit as a successful no-op', async () => {
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    harness.repository.commitWriting.mockResolvedValueOnce({ published: false });

    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        threadId: claim.threadId,
        topicId: 'topic-1',
      }),
    ).resolves.toEqual({ published: false, sourceFingerprint: 'github@1' });
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    vi.mocked(harness.dependencies.topic.findById).mockResolvedValueOnce({
      metadata: {
        runningOperation: {
          assistantMessageId: 'assistant-recovered',
          operationId: 'operation-recovered',
          threadId: claim.threadId,
        },
      },
    });

    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        threadId: claim.threadId,
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    harness.setThreadAssistant({
      content: JSON.stringify(analysis),
      id: 'assistant-completed',
      role: 'assistant',
      threadId: claim.threadId,
    });

    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        threadId: claim.threadId,
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ published: true, resultId: 'assistant-completed' });

    expect(harness.execAgent).not.toHaveBeenCalled();
    expect(harness.executeOperation).not.toHaveBeenCalled();
    expect(harness.repository.commitWriting).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMessageId: 'assistant-completed' }),
    );
  });

  it('never launches a second turn over an invalid assistant placeholder', async () => {
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });
    harness.setThreadAssistant({
      content: '',
      error: { message: 'generation failed' },
      id: 'assistant-placeholder',
      role: 'assistant',
      threadId: claim.threadId,
    });

    await expect(
      harness.service.writeCollected({
        sessionId: 'session-1',
        sourceFingerprint: 'github@1',
        threadId: claim.threadId,
        topicId: 'topic-1',
      }),
    ).rejects.toThrow('existing assistant output is invalid');
    expect(harness.execAgent).not.toHaveBeenCalled();
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
    const claim = await harness.service.claimWriting({
      sessionId: 'session-1',
      topicId: 'topic-1',
    });

    await harness.service.writeCollected({
      sessionId: 'session-1',
      sourceFingerprint: fingerprint,
      threadId: claim.threadId,
      topicId: 'topic-1',
    });

    const document = harness.execAgent.mock.calls[0][0].ephemeralUserMessage as string;
    expect(document.length).toBeLessThanOrEqual(MAX_AGENT_INPUT_LENGTH);
    expect(document.match(/<\/provider-context>/g)).toHaveLength(2);
    expect(document).toContain('github:A');
    expect(document).toContain('gmail:B');
    expect(document.endsWith('</provider-context>')).toBe(true);
  });

  it('guarded writing failure retains the previous proposal pointer', async () => {
    const previous = createSession({ github: providerState('completed', 1) });
    previous.writing = {
      resultMessageId: 'assistant-old',
      sourceFingerprint: 'github@1',
      status: 'failed',
      updatedAt: '2026-07-20T00:00:00.000Z',
      error: {
        code: 'UNDERSTANDING_WRITING_FAILED',
        message: 'understanding writing failed',
        operation: 'writing',
        provider: 'understanding',
        retryable: true,
      },
    };
    const harness = createHarness(previous);
    harness.repository.failWriting.mockResolvedValueOnce(previous);

    const result = await harness.service.failWriting({
      sessionId: 'session-1',
      sourceFingerprint: 'github@1',
      topicId: 'topic-1',
    });

    expect(result.writing?.resultMessageId).toBe('assistant-old');
  });
});

describe('UnderstandingService commands and polling', () => {
  it('uses a discard snapshot store for the private writer runtime', async () => {
    factoryMocks.agentRuntimeConstructor.mockClear();
    factoryMocks.writingClaimed = false;
    const service = await createUnderstandingService({ db: {} as never, userId: 'user-1' });

    const claim = await service.claimWriting({
      sessionId: 'session-factory',
      topicId: 'topic-1',
    });
    expect(factoryMocks.agentRuntimeConstructor).not.toHaveBeenCalled();
    await service.writeCollected({
      sessionId: 'session-factory',
      sourceFingerprint: claim.sourceFingerprint,
      threadId: claim.threadId,
      topicId: 'topic-1',
    });

    const options = factoryMocks.agentRuntimeConstructor.mock.calls[0][2] as {
      queueService: null;
      snapshotStore: {
        get: () => Promise<unknown>;
        list: () => Promise<unknown[]>;
        save: () => Promise<void>;
      };
    };
    expect(options.queueService).toBeNull();
    await expect(options.snapshotStore.get()).resolves.toBeNull();
    await expect(options.snapshotStore.list()).resolves.toEqual([]);
    await expect(options.snapshotStore.save()).resolves.toBeUndefined();
  });

  it('initializes provider state from the generic registry', async () => {
    const harness = createHarness(null);

    const session = await harness.service.initialize('topic-1');

    expect(session.sources).toEqual({
      github: providerState('pending'),
      gmail: providerState('pending'),
    });
    expect(harness.repository.initialize).toHaveBeenCalledWith('topic-1', 'session-new', [
      'github',
      'gmail',
    ]);
  });

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
  });
});
