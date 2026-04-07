import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockFindById, mockMessageCreate, mockMessageQuery } = vi.hoisted(
  () => ({
    mockCreateOperation: vi.fn(),
    mockFindById: vi.fn(),
    mockMessageCreate: vi.fn(),
    mockMessageQuery: vi.fn(),
  }),
);

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    findById: mockFindById,
    query: mockMessageQuery,
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(() => ({
    getUserSettings: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/userMemory/persona', () => ({
  UserPersonaModel: vi.fn().mockImplementation(() => ({
    getLatestPersonaDocument: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
}));

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();

  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - resume mode', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });

    mockFindById.mockResolvedValue({
      id: 'parent-msg-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      topicId: 'topic-1',
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'history user', id: 'history-1', role: 'user' },
      { content: 'history assistant', id: 'history-2', role: 'assistant' },
    ]);

    mockMessageCreate.mockResolvedValue({ id: 'assistant-msg-new' });

    service = new AiAgentService({} as any, 'user-1');
  });

  it('should create only a new assistant message in resume mode and use caller appContext', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: {
        sessionId: 'session-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      parentMessageId: 'parent-msg-1',
      prompt: 'caller prompt is ignored for runtime payload messages',
      resume: true,
    });

    expect(mockFindById).toHaveBeenCalledWith('parent-msg-1');
    expect(mockMessageQuery).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        threadId: 'thread-1',
        topicId: 'topic-1',
      },
      expect.any(Object),
    );
    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.any(String),
        parentId: 'parent-msg-1',
        role: 'assistant',
        threadId: 'thread-1',
        topicId: 'topic-1',
      }),
    );

    expect(mockCreateOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        appContext: expect.objectContaining({
          threadId: 'thread-1',
          topicId: 'topic-1',
        }),
        initialContext: expect.objectContaining({
          payload: expect.objectContaining({
            message: [{ content: '' }],
            parentMessageId: 'parent-msg-1',
          }),
          phase: 'user_input',
        }),
        initialMessages: [
          { content: 'history user', id: 'history-1', role: 'user' },
          { content: 'history assistant', id: 'history-2', role: 'assistant' },
        ],
      }),
    );
  });

  it('should reject missing appContext in resume mode', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        parentMessageId: 'parent-msg-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('appContext is required when resume is true');
  });

  it('should reject appContext.topicId mismatch in resume mode', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: {
          sessionId: 'session-1',
          threadId: 'thread-1',
          topicId: 'topic-other',
        },
        parentMessageId: 'parent-msg-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('appContext.topicId does not match parent message');
  });

  it('should require parentMessageId when resume is true', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        prompt: '',
        resume: true,
      }),
    ).rejects.toThrow('parentMessageId is required when resume is true');
  });
});
