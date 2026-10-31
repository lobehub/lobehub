import {
  UNDERSTANDING_ANALYSIS_JSON_SCHEMA,
  UNDERSTANDING_DETAILED_PERSONA_JSON_SCHEMA,
} from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  analysis,
  createHarness,
  createSession,
  diagnostics,
  providerState,
  storedContext,
} from './testUtils';

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

  /** @example Reconciliation dispatches only GitHub after Gmail fails for missing permission. */
  it('dispatches only provider attempts selected by atomic reconciliation', async () => {
    // ROOT CAUSE:
    //
    // Retrying a failed Understanding session operated only on its original provider manifest, so
    // a GitHub connection added after navigating backward was never dispatched. Retrying each failed
    // source independently also repeated non-retryable Gmail permission failures.
    //
    // We fixed this by letting the repository return the exact running revisions to dispatch.
    const gmail = {
      ...providerState('failed', 1),
      errors: [
        {
          code: 'GMAIL_READ_PERMISSION_REQUIRED',
          message: 'Gmail read permission is required',
          operation: 'permission',
          provider: 'gmail',
          retryable: false,
        },
      ],
      failedCount: 1,
    };
    const next = createSession({ github: providerState('running', 1), gmail });
    const harness = createHarness(createSession({ gmail }));
    harness.repository.extend.mockImplementationOnce(async () => {
      harness.setSession(next);
      return { attempts: [{ id: 'github', revision: 1 }], session: next };
    });

    await expect(
      harness.service.revise({
        providerIds: ['gmail', 'github'],
        responseLanguage: 'zh-CN',
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({
      sources: { github: { status: 'running' }, gmail: { status: 'failed' } },
    });

    expect(mockTriggerProviders).toHaveBeenCalledWith(
      expect.objectContaining({ providers: [{ id: 'github', revision: 1 }] }),
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

  /** @example A provider rejection remains actionable in persisted diagnostics. */
  it('persists the original provider failure message', async () => {
    const harness = createHarness(createSession({ gmail: providerState('running', 1) }));
    harness.setProvider('gmail', {
      collect: vi.fn(async () => ({
        context: '',
        diagnostics: {
          errors: [
            {
              code: 'GMAIL_READ_PERMISSION_REQUIRED',
              message: 'Gmail rejected the search because scope gmail.readonly is missing',
              operation: 'permission',
              provider: 'gmail',
              retryable: false,
            },
          ],
          evidenceCount: 0,
          failedCount: 1,
          succeededCount: 0,
        },
        sourceCount: 0,
      })),
      connectionSource: 'composio',
      id: 'gmail',
    });

    await expect(
      harness.service.processProvider({
        providerId: 'gmail',
        revision: 1,
        sessionId: 'session-1',
        topicId: 'topic-1',
      }),
    ).resolves.toMatchObject({ providerId: 'gmail', status: 'failed' });

    /** @example expect(failProvider).toHaveBeenCalledWith({ errors: [...] }); */
    expect(harness.repository.failProvider).toHaveBeenCalledWith({
      errors: [
        {
          code: 'GMAIL_READ_PERMISSION_REQUIRED',
          message: 'Gmail rejected the search because scope gmail.readonly is missing',
          operation: 'permission',
          provider: 'gmail',
          retryable: false,
        },
      ],
      failedCount: 1,
      providerId: 'gmail',
      revision: 1,
      sessionId: 'session-1',
      succeededCount: 0,
      topicId: 'topic-1',
    });
  });

  /** @example expect(failProvider).toContain('GraphQL FORBIDDEN'); */
  it('persists a raw non-retryable provider exception without wrapping it', async () => {
    // ROOT CAUSE:
    //
    // Connector retry wrapped terminal upstream exceptions in ConnectorDataError before the
    // Understanding service observed them. That discarded the original error identity and stack.
    //
    // Before: Error("GraphQL FORBIDDEN at viewer.repository") became
    // ConnectorDataError("github collection failed").
    //
    // We fixed this by rethrowing the original exception and converting it only at the DB
    // diagnostic boundary, where its original message is retained.
    const harness = createHarness(createSession({ github: providerState('running', 1) }));
    const upstreamError = Object.assign(
      new Error('GraphQL FORBIDDEN at viewer.repository(name: profile)'),
      { status: 403 },
    );
    harness.setProvider('github', {
      collect: vi.fn(async () => {
        throw upstreamError;
      }),
      connectionSource: 'lobehub',
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

    /** @example expect(failProvider).toHaveBeenCalledWith({ errors: [...] }); */
    expect(harness.repository.failProvider).toHaveBeenCalledWith({
      errors: [
        {
          code: 'UNDERSTANDING_PROVIDER_COLLECTION_FAILED',
          message: upstreamError.message,
          operation: 'collection',
          provider: 'github',
          retryable: false,
        },
      ],
      failedCount: 1,
      providerId: 'github',
      revision: 1,
      sessionId: 'session-1',
      succeededCount: 0,
      topicId: 'topic-1',
    });
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
      expect.objectContaining({
        metadata: { trigger: RequestTrigger.Onboarding },
        tracing: {
          promptVersion: 'v1',
          scenario: 'understanding_analysis',
          schemaName: 'understanding_batch_analysis',
        },
      }),
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
      expect.objectContaining({
        metadata: { trigger: RequestTrigger.Onboarding },
        tracing: {
          promptVersion: 'v1',
          scenario: 'understanding_detailed_persona',
          schemaName: 'understanding_detailed_persona',
        },
      }),
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
