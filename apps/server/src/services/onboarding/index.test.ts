// @vitest-environment node
import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { OnboardingUnderstandingRepository } from '@lobechat/database';
import type { OnboardingUnderstandingSession } from '@lobechat/types';
import { SaveUserQuestionInputSchema } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { UnderstandingSourceStore } from '@/server/services/understanding/sourceStore';

import { OnboardingService } from './index';

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn(),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn(),
}));

vi.mock('@/server/services/agentDocuments', () => ({
  AgentDocumentsService: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  OnboardingUnderstandingRepository: vi.fn(),
}));

vi.mock('@/server/services/understanding/sourceStore', () => ({
  UnderstandingSourceStore: vi.fn(),
}));

describe('OnboardingService', () => {
  const userId = 'user-1';

  let mockAgentDocumentsService: {
    deleteTemplateDocuments: ReturnType<typeof vi.fn>;
    getAgentDocuments: ReturnType<typeof vi.fn>;
    upsertDocument: ReturnType<typeof vi.fn>;
  };
  let mockAgentModel: {
    getBuiltinAgent: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let mockAgentService: {
    getBuiltinAgent: ReturnType<typeof vi.fn>;
  };
  let mockDb: any;
  let mockMessageModel: {
    create: ReturnType<typeof vi.fn>;
    findFirstAssistantInTopic: ReturnType<typeof vi.fn>;
    hasTopicMessages: ReturnType<typeof vi.fn>;
    listMessagePluginsByTopic: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
  let mockTopicModel: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    updateMetadata: ReturnType<typeof vi.fn>;
  };
  let persistedUserState: any;
  let persistedTopics: Record<string, any>;
  let mockSourceStore: {
    deleteSession: ReturnType<typeof vi.fn>;
  };
  let mockUnderstandingRepository: {
    removeForReset: ReturnType<typeof vi.fn>;
  };
  let mockUserModel: {
    getUserSettings: ReturnType<typeof vi.fn>;
    getUserState: ReturnType<typeof vi.fn>;
    updateSetting: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>;
  };
  let transactionUpdateCalls: Array<{
    set: ReturnType<typeof vi.fn>;
    table: unknown;
    where: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    persistedUserState = {
      agentOnboarding: {
        version: CURRENT_ONBOARDING_VERSION,
      },
      fullName: undefined,
      interests: undefined,
      settings: { general: {} },
    };
    persistedTopics = {};
    transactionUpdateCalls = [];

    mockDb = {
      delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      execute: vi.fn(async () => undefined),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ count: 0 }]),
        })),
      })),
      transaction: vi.fn(async (callback) =>
        callback({
          execute: vi.fn(async () => undefined),
          update: vi.fn((table) => {
            const where = vi.fn(async () => undefined);
            const set = vi.fn(() => ({ where }));

            transactionUpdateCalls.push({ set, table, where });

            return { set };
          }),
        }),
      ),
    };

    mockUserModel = {
      getUserSettings: vi.fn(async () => persistedUserState.settings),
      getUserState: vi.fn(async () => persistedUserState),
      updateSetting: vi.fn(async (patch) => {
        persistedUserState.settings = merge(persistedUserState.settings ?? {}, patch);
      }),
      updateUser: vi.fn(async (patch) => {
        if ('agentOnboarding' in patch) {
          persistedUserState = {
            ...persistedUserState,
            ...patch,
            agentOnboarding: patch.agentOnboarding,
          };

          return;
        }

        persistedUserState = merge(persistedUserState, patch);
      }),
    };
    mockMessageModel = {
      create: vi.fn(async () => ({
        agentId: 'builtin-agent-1',
        content: 'welcome',
        id: 'message-1',
        role: 'assistant',
        topicId: 'topic-1',
      })),
      findFirstAssistantInTopic: vi.fn(async () => undefined),
      hasTopicMessages: vi.fn(async () => false),
      listMessagePluginsByTopic: vi.fn(async () => []),
      query: vi.fn(async () => []),
    };
    mockTopicModel = {
      create: vi.fn(async () => {
        const topic = { agentId: 'builtin-agent-1', id: 'topic-1', metadata: undefined };
        persistedTopics[topic.id] = topic;

        return topic;
      }),
      findById: vi.fn(async (id: string) => persistedTopics[id]),
      updateMetadata: vi.fn(async (id: string, metadata: any) => {
        const existing = persistedTopics[id] ?? { id, metadata: undefined };
        const nextTopic = {
          ...existing,
          metadata: {
            ...existing.metadata,
            ...metadata,
          },
        };

        persistedTopics[id] = nextTopic;

        return [nextTopic];
      }),
    };
    mockAgentService = {
      getBuiltinAgent: vi.fn(async () => ({ id: 'builtin-agent-1' })),
    };
    mockAgentModel = {
      getBuiltinAgent: vi.fn(async () => ({ avatar: null, id: 'inbox-agent-1', title: null })),
      update: vi.fn(async () => undefined),
    };
    mockAgentDocumentsService = {
      deleteTemplateDocuments: vi.fn(async () => undefined),
      getAgentDocuments: vi.fn(async () => []),
      upsertDocument: vi.fn(async () => undefined),
    };
    mockSourceStore = {
      deleteSession: vi.fn(async () => undefined),
    };
    mockUnderstandingRepository = {
      removeForReset: vi.fn(async () => undefined),
    };

    vi.mocked(AgentModel).mockImplementation(() => mockAgentModel as any);
    vi.mocked(AgentDocumentsService).mockImplementation(() => mockAgentDocumentsService as any);
    vi.mocked(MessageModel).mockImplementation(() => mockMessageModel as any);
    vi.mocked(UserModel).mockImplementation(() => mockUserModel as any);
    vi.mocked(TopicModel).mockImplementation(() => mockTopicModel as any);
    vi.mocked(AgentService).mockImplementation(() => mockAgentService as any);
    vi.mocked(UnderstandingSourceStore).mockImplementation(() => mockSourceStore as any);
    vi.mocked(OnboardingUnderstandingRepository).mockImplementation(
      () => mockUnderstandingRepository as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts the flat structured schema', () => {
    const parsed = SaveUserQuestionInputSchema.parse({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
    });

    expect(parsed).toEqual({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
    });
  });

  it('returns missing structured fields in the minimal onboarding context', async () => {
    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context).toEqual({
      finished: false,
      missingStructuredFields: ['agentName', 'agentEmoji', 'fullName'],
      phase: 'agent_identity',
      topicId: undefined,
      version: CURRENT_ONBOARDING_VERSION,
    });
  });

  it('persists fullName and interests through saveUserQuestion', async () => {
    const service = new OnboardingService(mockDb, userId);
    const result = await service.saveUserQuestion({
      customInterests: ['AI tooling'],
      fullName: 'Ada Lovelace',
      interests: ['coding'],
    });

    expect(result).toEqual({
      content: 'Saved full name and interests.',
      ignoredFields: [],
      savedFields: ['fullName', 'interests'],
      success: true,
      unchangedFields: [],
    });
    expect(persistedUserState.fullName).toBe('Ada Lovelace');
    expect(persistedUserState.interests).toEqual(['coding', 'AI tooling']);
  });

  it('ignores responseLanguage if the agent still tries to send it', async () => {
    const service = new OnboardingService(mockDb, userId);
    const result = await service.saveUserQuestion({
      fullName: 'Ada Lovelace',
      // The schema no longer accepts responseLanguage. Test the reachable
      // shape — extra props arrive via parseToolArguments and land in
      // ignoredFields rather than blowing up the call.
      ...({ responseLanguage: 'en-US' } as Record<string, string>),
    });

    expect(result.success).toBe(true);
    expect(result.savedFields).toEqual(['fullName']);
    expect(result.ignoredFields).toEqual(['responseLanguage']);
    expect(persistedUserState.settings.general.responseLanguage).toBeUndefined();
  });

  it('does not save agent identity when the proposed agentName matches the user identity', async () => {
    const service = new OnboardingService(mockDb, userId);
    const result = await service.saveUserQuestion({
      agentEmoji: '😀',
      agentName: 'anbex',
      fullName: 'anbex',
    });

    expect(result.success).toBe(true);
    expect(result.savedFields).toEqual(['fullName']);
    expect(result.ignoredFields).toEqual(['agentName', 'agentEmoji']);
    expect(result.content).toContain(
      'Skipped agent identity because agentName matches the user identity',
    );
    expect(persistedUserState.fullName).toBe('anbex');
    expect(mockAgentModel.update).not.toHaveBeenCalled();
  });

  it('rejects saveUserQuestion when no supported fields are provided', async () => {
    const service = new OnboardingService(mockDb, userId);
    const result = await service.saveUserQuestion({});

    expect(result).toEqual({
      content:
        'No supported structured fields were provided. Use document tools for markdown-based onboarding content.',
      ignoredFields: [],
      success: false,
    });
  });

  it('reports no missing structured fields when the minimal profile is complete', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    persistedUserState.interests = ['AI tooling'];

    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context.missingStructuredFields).toEqual([]);
    expect(context.phase).toBe('summary');
    expect(context.finished).toBe(false);
  });

  it('resets the active Understanding session and its temporary source data', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    const understandingSession: OnboardingUnderstandingSession = {
      id: 'understanding-session',
      sources: {
        github: {
          errors: [],
          failedCount: 0,
          revision: 1,
          status: 'completed',
          succeededCount: 1,
        },
      },
    };
    mockUnderstandingRepository.removeForReset.mockResolvedValue(understandingSession);

    const service = new OnboardingService(mockDb, userId);
    const result = await service.reset();

    expect(mockUnderstandingRepository.removeForReset).toHaveBeenCalledWith('topic-1');
    expect(mockUnderstandingRepository.removeForReset.mock.invocationCallOrder[0]).toBeLessThan(
      mockUserModel.updateUser.mock.invocationCallOrder[0],
    );
    expect(mockSourceStore.deleteSession).toHaveBeenCalledWith({
      sessionId: understandingSession.id,
      userId,
    });
    expect(result).toEqual({ version: CURRENT_ONBOARDING_VERSION });
    expect(persistedUserState.agentOnboarding.activeTopicId).toBeUndefined();
  });

  it('still resets onboarding when Understanding external cleanup fails', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    mockUnderstandingRepository.removeForReset.mockResolvedValue({
      id: 'understanding-session',
      sources: {},
    });
    mockSourceStore.deleteSession.mockRejectedValue(new Error('redis unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const service = new OnboardingService(mockDb, userId);
    await expect(service.reset()).resolves.toEqual({ version: CURRENT_ONBOARDING_VERSION });

    expect(persistedUserState.agentOnboarding.activeTopicId).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('creates a topic during onboarding bootstrap without persisting a welcome message', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T08:00:00.000Z'));

    const service = new OnboardingService(mockDb, userId);
    const result = await service.getOrCreateState();

    expect(result.topicId).toBe('topic-1');
    expect(result.agentOnboarding.activeTopicId).toBe('topic-1');
    expect(result.feedbackSubmitted).toBe(false);
    // The welcome is rendered client-side from i18n, so the bootstrap
    // must NOT seed an assistant message into the topic.
    expect(mockMessageModel.create).not.toHaveBeenCalled();
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession).toEqual({
      lastActiveAt: '2026-04-17T08:00:00.000Z',
      phase: 'agent_identity',
      startedAt: '2026-04-17T08:00:00.000Z',
      version: CURRENT_ONBOARDING_VERSION,
    });
  });

  it('reports feedbackSubmitted when topic.metadata.onboardingFeedback is present', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    persistedTopics['topic-1'] = {
      agentId: 'web-onboarding-agent',
      id: 'topic-1',
      metadata: {
        onboardingFeedback: { rating: 'good', submittedAt: '2026-04-16T00:00:00.000Z' },
      },
    };

    const service = new OnboardingService(mockDb, userId);
    const result = await service.getOrCreateState();

    expect(result.feedbackSubmitted).toBe(true);
  });

  it('transfers the onboarding topic to the inbox agent when finishing', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    persistedTopics['topic-1'] = {
      agentId: 'web-onboarding-agent',
      id: 'topic-1',
      metadata: {
        onboardingSession: {
          agentMarketplacePick: {
            categoryHints: ['engineering'],
            installedAgentIds: ['agent-1'],
            requestId: 'req-1',
            resolvedAt: '2026-04-16T00:30:00.000Z',
            selectedTemplateIds: ['template-1'],
            status: 'submitted',
          },
          lastActiveAt: '2026-04-16T00:00:00.000Z',
          phase: 'summary',
          startedAt: '2026-04-16T00:00:00.000Z',
          version: CURRENT_ONBOARDING_VERSION,
        },
      },
    };
    mockMessageModel.listMessagePluginsByTopic.mockResolvedValue([
      {
        apiName: 'createAgent',
        arguments: JSON.stringify({ title: ' Planner ' }),
        id: 'tool-1',
        identifier: 'lobe-agent-management',
        state: { agentId: 'agent-1', success: true },
        type: 'default',
        userId,
      },
      {
        apiName: 'createAgent',
        arguments: JSON.stringify({ title: 'Fallback Analyst' }),
        id: 'tool-2',
        identifier: 'lobe-group-agent-builder',
        state: { agentId: 'agent-2', success: true, title: '   ' },
        type: 'default',
        userId,
      },
      {
        apiName: 'batchCreateAgents',
        arguments: JSON.stringify({
          agents: [{ title: 'Coder' }, { title: 'Planner' }, { title: 'Ops' }],
        }),
        id: 'tool-3',
        identifier: 'lobe-group-agent-builder',
        state: {
          agents: [{ title: 'Coder' }, { title: '' }, {}],
          failedCount: 0,
          successCount: 3,
        },
        type: 'default',
        userId,
      },
      {
        apiName: 'inviteAgent',
        arguments: JSON.stringify({ agentId: 'existing-agent' }),
        id: 'tool-4',
        identifier: 'lobe-group-agent-builder',
        state: { success: true },
        type: 'default',
        userId,
      },
      {
        apiName: 'createAgent',
        arguments: JSON.stringify({ title: 'Ignored Failed Agent' }),
        error: { message: 'boom' },
        id: 'tool-5',
        identifier: 'lobe-agent-management',
        state: { success: false },
        type: 'default',
        userId,
      },
    ]);

    const service = new OnboardingService(mockDb as any, userId);
    const result = await service.finishOnboarding();

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('inbox-agent-1');
    expect(result.topicId).toBe('topic-1');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(transactionUpdateCalls).toHaveLength(3);
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.finishedAt).toEqual(
      result.finishedAt,
    );
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.finalAgentNames).toEqual([
      'Planner',
      'Fallback Analyst',
      'Coder',
      'Ops',
    ]);
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.agentMarketplacePick).toEqual({
      categoryHints: ['engineering'],
      installedAgentIds: ['agent-1'],
      requestId: 'req-1',
      resolvedAt: '2026-04-16T00:30:00.000Z',
      selectedTemplateIds: ['template-1'],
      status: 'submitted',
    });
  });

  it('is idempotent when finishOnboarding is called after completion', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      finishedAt: '2026-03-24T00:00:00.000Z',
      version: CURRENT_ONBOARDING_VERSION,
    };
    persistedTopics['topic-1'] = { agentId: 'inbox-agent-1', id: 'topic-1', metadata: {} };

    const service = new OnboardingService(mockDb as any, userId);
    const result = await service.finishOnboarding();

    expect(result).toEqual({
      agentId: 'inbox-agent-1',
      content: 'Agent onboarding already completed.',
      finishedAt: '2026-03-24T00:00:00.000Z',
      success: true,
      topicId: 'topic-1',
    });
  });

  it('writes onboarding milestones only once as phase advances', async () => {
    vi.useFakeTimers();
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    persistedTopics['topic-1'] = { agentId: 'web-onboarding-agent', id: 'topic-1', metadata: {} };

    const service = new OnboardingService(mockDb, userId);

    vi.setSystemTime(new Date('2026-04-17T08:00:00.000Z'));
    let context = await service.getState();
    expect(context.phase).toBe('agent_identity');
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession).toEqual({
      lastActiveAt: '2026-04-17T08:00:00.000Z',
      phase: 'agent_identity',
      startedAt: '2026-04-17T08:00:00.000Z',
      version: CURRENT_ONBOARDING_VERSION,
    });

    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });

    vi.setSystemTime(new Date('2026-04-17T09:00:00.000Z'));
    context = await service.getState();
    expect(context.phase).toBe('user_identity');
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.agentIdentityCompletedAt).toBe(
      '2026-04-17T09:00:00.000Z',
    );

    vi.setSystemTime(new Date('2026-04-17T10:00:00.000Z'));
    await service.getState();
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.agentIdentityCompletedAt).toBe(
      '2026-04-17T09:00:00.000Z',
    );

    persistedUserState.fullName = 'Ada Lovelace';

    vi.setSystemTime(new Date('2026-04-17T11:00:00.000Z'));
    context = await service.getState();
    expect(context.phase).toBe('discovery');
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.userIdentityCompletedAt).toBe(
      '2026-04-17T11:00:00.000Z',
    );

    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
    await service.getState();
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.userIdentityCompletedAt).toBe(
      '2026-04-17T11:00:00.000Z',
    );

    persistedUserState.interests = ['AI tooling'];
    persistedUserState.agentOnboarding.discoveryStartUserMessageCount = 0;
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 5 }]),
      })),
    });

    vi.setSystemTime(new Date('2026-04-17T13:00:00.000Z'));
    context = await service.getState();
    expect(context.phase).toBe('summary');
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.discoveryCompletedAt).toBe(
      '2026-04-17T13:00:00.000Z',
    );

    vi.setSystemTime(new Date('2026-04-17T14:00:00.000Z'));
    await service.getState();
    expect(persistedTopics['topic-1']?.metadata?.onboardingSession?.discoveryCompletedAt).toBe(
      '2026-04-17T13:00:00.000Z',
    );
  });

  it('stays in discovery when all fields complete but discovery exchanges < minimum', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      discoveryStartUserMessageCount: 3,
      version: CURRENT_ONBOARDING_VERSION,
    };

    // 3 user messages total, baseline was 3 → 0 discovery exchanges (< MIN_DISCOVERY_USER_MESSAGES=1)
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 3 }]),
      })),
    });

    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context.phase).toBe('discovery');
    expect(context.discoveryUserMessageCount).toBe(0);
    // remaining = RECOMMENDED_DISCOVERY_USER_MESSAGES(1) - 0 = 1
    expect(context.remainingDiscoveryExchanges).toBe(1);
  });

  it('advances to summary when discovery exchanges reach minimum threshold', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    persistedUserState.interests = ['AI tooling'];
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      discoveryStartUserMessageCount: 3,
      version: CURRENT_ONBOARDING_VERSION,
    };

    // 8 user messages total, baseline was 3 → 5 discovery exchanges (>= MIN_DISCOVERY_USER_MESSAGES=1)
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 8 }]),
      })),
    });

    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context.phase).toBe('summary');
  });

  it('captures discovery baseline on first entry to discovery phase', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    // agentName + fullName set → past pre-discovery; 0 discovery exchanges keeps phase in discovery
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };

    // 3 user messages at discovery entry
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 3 }]),
      })),
    });

    const service = new OnboardingService(mockDb, userId);
    await service.getState();

    // Baseline should be persisted
    expect(persistedUserState.agentOnboarding.discoveryStartUserMessageCount).toBe(3);
  });

  it('does not overwrite discovery baseline on subsequent getState calls', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      discoveryStartUserMessageCount: 3,
      version: CURRENT_ONBOARDING_VERSION,
    };

    // Now 6 user messages
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 6 }]),
      })),
    });

    const service = new OnboardingService(mockDb, userId);
    await service.getState();

    // Baseline should remain 3, not updated to 6
    expect(persistedUserState.agentOnboarding.discoveryStartUserMessageCount).toBe(3);
  });

  describe('getBootstrapState', () => {
    it('returns fresh state (topicId=null, hasMessages=false) when no topic exists', async () => {
      const service = new OnboardingService(mockDb, userId);
      const result = await service.getBootstrapState();

      expect(result.topicId).toBeNull();
      expect(result.hasMessages).toBe(false);
      expect(mockMessageModel.hasTopicMessages).not.toHaveBeenCalled();
      // Must NOT create a topic on a read-only call.
      expect(mockTopicModel.create).not.toHaveBeenCalled();
    });

    it('returns returning state with hasMessages=true when topic has messages', async () => {
      persistedUserState.agentOnboarding = {
        activeTopicId: 'topic-1',
        version: CURRENT_ONBOARDING_VERSION,
      };
      persistedTopics['topic-1'] = { agentId: 'builtin-agent-1', id: 'topic-1', metadata: {} };
      mockMessageModel.hasTopicMessages.mockResolvedValue(true);

      const service = new OnboardingService(mockDb, userId);
      const result = await service.getBootstrapState();

      expect(result.topicId).toBe('topic-1');
      expect(result.hasMessages).toBe(true);
      expect(mockMessageModel.hasTopicMessages).toHaveBeenCalledWith('topic-1');
    });

    it('does not expose stale activeTopicId when the topic no longer exists', async () => {
      persistedUserState.agentOnboarding = {
        activeTopicId: 'missing-topic',
        version: CURRENT_ONBOARDING_VERSION,
      };

      const service = new OnboardingService(mockDb, userId);
      const result = await service.getBootstrapState();

      expect(result.topicId).toBeNull();
      expect(result.context.topicId).toBeUndefined();
      expect(result.hasMessages).toBe(false);
      expect(mockTopicModel.findById).toHaveBeenCalledWith('missing-topic');
      expect(mockMessageModel.hasTopicMessages).not.toHaveBeenCalled();
      expect(mockTopicModel.create).not.toHaveBeenCalled();
      expect(mockUserModel.updateUser).not.toHaveBeenCalled();
    });

    it('does not write the discovery baseline (read-only semantics)', async () => {
      persistedUserState.agentOnboarding = {
        activeTopicId: 'topic-1',
        version: CURRENT_ONBOARDING_VERSION,
      };
      persistedTopics['topic-1'] = { agentId: 'builtin-agent-1', id: 'topic-1', metadata: {} };
      persistedUserState.fullName = 'Ada';
      mockAgentModel.getBuiltinAgent.mockResolvedValue({
        avatar: '😀',
        id: 'inbox-agent-1',
        title: 'Inbox',
      });
      mockDb.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ count: 4 }]),
        })),
      });

      const service = new OnboardingService(mockDb, userId);
      await service.getBootstrapState();

      // Baseline must remain undefined — read-only getBootstrapState never writes.
      expect(persistedUserState.agentOnboarding.discoveryStartUserMessageCount).toBeUndefined();
      expect(mockUserModel.updateUser).not.toHaveBeenCalled();
    });
  });

  describe('sendOnboardingFirstMessage', () => {
    it('creates topic without persisting the UI-only welcome on first call', async () => {
      const service = new OnboardingService(mockDb, userId);
      mockMessageModel.query.mockResolvedValueOnce([]);

      const result = await service.sendOnboardingFirstMessage({
        agentId: 'builtin-agent-1',
      });

      expect(mockTopicModel.create).toHaveBeenCalledTimes(1);
      expect(mockMessageModel.findFirstAssistantInTopic).not.toHaveBeenCalled();
      expect(mockMessageModel.create).not.toHaveBeenCalled();
      expect(persistedUserState.agentOnboarding.activeTopicId).toBe('topic-1');
      expect(result.topicId).toBe('topic-1');
      expect(result.messages).toHaveLength(0);
    });

    it('is idempotent when an active topic already exists', async () => {
      persistedUserState.agentOnboarding = {
        activeTopicId: 'topic-1',
        version: CURRENT_ONBOARDING_VERSION,
      };
      persistedTopics['topic-1'] = { agentId: 'builtin-agent-1', id: 'topic-1', metadata: {} };
      mockMessageModel.query.mockResolvedValueOnce([
        { content: 'hello', id: 'message-1', role: 'user' },
      ]);

      const service = new OnboardingService(mockDb, userId);
      const result = await service.sendOnboardingFirstMessage({
        agentId: 'builtin-agent-1',
      });

      expect(mockTopicModel.create).not.toHaveBeenCalled();
      expect(mockMessageModel.create).not.toHaveBeenCalled();
      expect(result.topicId).toBe('topic-1');
    });

    it('acquires the advisory lock before mutating', async () => {
      const executeSpy = vi.fn(async () => undefined);
      mockDb.transaction = vi.fn(async (callback: any) =>
        callback({
          execute: executeSpy,
          update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
        }),
      );
      mockMessageModel.query.mockResolvedValueOnce([]);

      const service = new OnboardingService(mockDb, userId);
      await service.sendOnboardingFirstMessage({
        agentId: 'builtin-agent-1',
      });

      expect(executeSpy).toHaveBeenCalledTimes(1);
      // The first (only) execute call inside the transaction is the advisory lock.
      // We assert structurally rather than on the exact SQL fragment.
      expect(executeSpy).toHaveBeenCalled();
    });
  });
});
