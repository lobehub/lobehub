// @vitest-environment node
import { CURRENT_ONBOARDING_VERSION } from '@lobechat/const';
import { SaveUserQuestionInputSchema } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    query: ReturnType<typeof vi.fn>;
  };
  let mockTopicModel: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let persistedUserState: any;
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
      query: vi.fn(async () => []),
    };
    mockTopicModel = {
      create: vi.fn(async () => ({ id: 'topic-1' })),
      findById: vi.fn(async () => undefined),
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
    const service = new OnboardingService(mockDb, userId);
    const result = await service.getOrCreateState();

    expect(result.topicId).toBe('topic-1');
    expect(result.agentOnboarding.activeTopicId).toBe('topic-1');
    expect(mockMessageModel.create).toHaveBeenCalledTimes(1);
  });

  it('transfers the onboarding topic to the inbox agent when finishing', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      version: CURRENT_ONBOARDING_VERSION,
    };
    mockTopicModel.findById.mockResolvedValue({ agentId: 'web-onboarding-agent', id: 'topic-1' });

    const service = new OnboardingService(mockDb as any, userId);
    const result = await service.finishOnboarding();

    expect(result.success).toBe(true);
    expect(result.agentId).toBe('inbox-agent-1');
    expect(result.topicId).toBe('topic-1');
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(transactionUpdateCalls).toHaveLength(3);
  });

  it('is idempotent when finishOnboarding is called after completion', async () => {
    persistedUserState.agentOnboarding = {
      activeTopicId: 'topic-1',
      finishedAt: '2026-03-24T00:00:00.000Z',
      version: CURRENT_ONBOARDING_VERSION,
    };
    mockTopicModel.findById.mockResolvedValue({ agentId: 'inbox-agent-1', id: 'topic-1' });

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
