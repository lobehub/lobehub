import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockMessageCreate, mockMessageQuery } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
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

describe('AiAgentService.execAgent - existingMessageIds', () => {
  let service: AiAgentService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });

    mockMessageQuery.mockResolvedValue([
      { content: 'hello', id: 'existing-user-1', role: 'user' },
      { content: '...', id: 'existing-assistant-1', role: 'assistant' },
    ]);

    mockMessageCreate.mockResolvedValue({ id: 'new-msg-1' });

    service = new AiAgentService({} as any, 'user-1');
  });

  it('should NOT create user or assistant messages when existingMessageIds are provided', async () => {
    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      existingMessageIds: ['existing-user-1', 'existing-assistant-1'],
      prompt: 'hello',
    });

    // Should not create any messages — reuse existing ones
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(result.userMessageId).toBe('existing-user-1');
    expect(result.assistantMessageId).toBe('existing-assistant-1');
    expect(result.success).toBe(true);
  });

  it('should create both messages when existingMessageIds is empty', async () => {
    mockMessageCreate
      .mockResolvedValueOnce({ id: 'new-user-1' }) // user message
      .mockResolvedValueOnce({ id: 'new-assistant-1' }); // assistant message

    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'hello',
    });

    // Should create both user and assistant messages
    expect(mockMessageCreate).toHaveBeenCalledTimes(2);
    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hello' }),
    );
    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
    expect(result.userMessageId).toBe('new-user-1');
    expect(result.assistantMessageId).toBe('new-assistant-1');
  });

  it('should only skip user message when only userMessageId is provided', async () => {
    mockMessageCreate.mockResolvedValueOnce({ id: 'new-assistant-1' });

    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      existingMessageIds: ['existing-user-1'],
      prompt: 'hello',
    });

    // Should only create assistant message
    expect(mockMessageCreate).toHaveBeenCalledTimes(1);
    expect(mockMessageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant' }));
    expect(result.userMessageId).toBe('existing-user-1');
    expect(result.assistantMessageId).toBe('new-assistant-1');
  });
});
