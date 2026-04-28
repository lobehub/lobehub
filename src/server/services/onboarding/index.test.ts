// @vitest-environment node
import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { SaveUserQuestionInputSchema } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { AgentService } from '@/server/services/agent';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

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
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ count: 0 }]),
        })),
      })),
      transaction: vi.fn(async (callback) =>
        callback({
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
      create: vi.fn(async () => ({ id: 'message-1' })),
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

    vi.mocked(AgentModel).mockImplementation(() => mockAgentModel as any);
    vi.mocked(AgentDocumentsService).mockImplementation(() => mockAgentDocumentsService as any);
    vi.mocked(MessageModel).mockImplementation(() => mockMessageModel as any);
    vi.mocked(UserModel).mockImplementation(() => mockUserModel as any);
    vi.mocked(TopicModel).mockImplementation(() => mockTopicModel as any);
    vi.mocked(AgentService).mockImplementation(() => mockAgentService as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts the flat structured schema', () => {
    const parsed = SaveUserQuestionInputSchema.parse({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
      responseLanguage: 'en-US',
    });

    expect(parsed).toEqual({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
      responseLanguage: 'en-US',
    });
  });

  it('returns missing structured fields in the minimal onboarding context', async () => {
    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context).toEqual({
      finished: false,
      missingStructuredFields: [
        'agentName',
        'agentEmoji',
        'fullName',
        'interests',
        'responseLanguage',
      ],
      phase: 'agent_identity',
      topicId: undefined,
      version: CURRENT_ONBOARDING_VERSION,
    });
  });

  it('persists fullName, interests, and responseLanguage through saveUserQuestion', async () => {
    const service = new OnboardingService(mockDb, userId);
    const result = await service.saveUserQuestion({
      fullName: 'Ada Lovelace',
      interests: ['AI tooling'],
      responseLanguage: 'en-US',
    });

    expect(result).toEqual({
      content: 'Saved full name, interests, and response language.',
      ignoredFields: [],
      savedFields: ['fullName', 'interests', 'responseLanguage'],
      success: true,
      unchangedFields: [],
    });
    expect(persistedUserState.fullName).toBe('Ada Lovelace');
    expect(persistedUserState.interests).toEqual(['AI tooling']);
    expect(persistedUserState.settings.general.responseLanguage).toBe('en-US');
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
    persistedUserState.settings.general.responseLanguage = 'en-US';

    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context.missingStructuredFields).toEqual([]);
    expect(context.phase).toBe('summary');
    expect(context.finished).toBe(false);
  });

  it('creates a topic and welcome message during onboarding bootstrap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T08:00:00.000Z'));

    const service = new OnboardingService(mockDb, userId);
    const result = await service.getOrCreateState();

    expect(result.topicId).toBe('topic-1');
    expect(result.agentOnboarding.activeTopicId).toBe('topic-1');
    expect(result.feedbackSubmitted).toBe(false);
    expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
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
    persistedUserState.settings.general.responseLanguage = 'en-US';
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
    persistedUserState.interests = ['AI tooling'];
    persistedUserState.settings.general.responseLanguage = 'en-US';
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      discoveryStartUserMessageCount: 3,
      version: CURRENT_ONBOARDING_VERSION,
    };

    // 4 user messages total, baseline was 3 → only 1 discovery exchange (< MIN_DISCOVERY_USER_MESSAGES=5)
    mockDb.select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ count: 4 }]),
      })),
    });

    const service = new OnboardingService(mockDb, userId);
    const context = await service.getState();

    expect(context.phase).toBe('discovery');
    expect(context.discoveryUserMessageCount).toBe(1);
    // remaining = RECOMMENDED_DISCOVERY_USER_MESSAGES(8) - 1 = 7
    expect(context.remainingDiscoveryExchanges).toBe(7);
  });

  it('advances to summary when discovery exchanges reach minimum threshold', async () => {
    mockAgentModel.getBuiltinAgent.mockResolvedValue({
      avatar: '⚡',
      id: 'inbox-agent-1',
      title: 'Jarvis',
    });
    persistedUserState.fullName = 'Ada Lovelace';
    persistedUserState.interests = ['AI tooling'];
    persistedUserState.settings.general.responseLanguage = 'en-US';
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      discoveryStartUserMessageCount: 3,
      version: CURRENT_ONBOARDING_VERSION,
    };

    // 8 user messages total, baseline was 3 → 5 discovery exchanges (= MIN_DISCOVERY_USER_MESSAGES)
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
    // interests NOT set — so phase would be discovery due to missing field
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
});
