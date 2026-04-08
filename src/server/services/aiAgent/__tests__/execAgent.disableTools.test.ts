import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const {
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockGetAgentConfig,
  mockGetKlavisManifests,
  mockGetLobehubSkillManifests,
  mockMessageCreate,
  mockPluginQuery,
} = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockGetAgentConfig: vi.fn(),
  mockGetKlavisManifests: vi.fn().mockResolvedValue([]),
  mockGetLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  mockMessageCreate: vi.fn(),
  mockPluginQuery: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: mockGetAgentConfig,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: mockPluginQuery,
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

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: mockGetLobehubSkillManifests,
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: mockGetKlavisManifests,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('model-bank', () => ({
  LOBE_DEFAULT_MODEL_LIST: [
    {
      abilities: { functionCall: true },
      id: 'gpt-4',
      providerId: 'openai',
    },
  ],
}));

describe('AiAgentService.execAgent - disableTools', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-1',
      model: 'gpt-4',
      plugins: ['plugin-a'],
      provider: 'openai',
      systemRole: 'You are a helper',
    });
    service = new AiAgentService(mockDb, userId);
  });

  it('should skip all tool discovery when disableTools is true', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      disableTools: true,
      prompt: 'Hello',
    } as any);

    // Plugin DB query should NOT be called
    expect(mockPluginQuery).not.toHaveBeenCalled();

    // Manifest fetches should NOT be called
    expect(mockGetLobehubSkillManifests).not.toHaveBeenCalled();
    expect(mockGetKlavisManifests).not.toHaveBeenCalled();

    // ToolsEngine should NOT be created
    expect(mockCreateServerAgentToolsEngine).not.toHaveBeenCalled();

    // createOperation should still be called with tools=undefined
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.tools).toBeUndefined();
  });

  it('should perform full tool discovery when disableTools is not set', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Hello',
    });

    // All tool discovery steps should be called
    expect(mockPluginQuery).toHaveBeenCalledTimes(1);
    expect(mockGetLobehubSkillManifests).toHaveBeenCalledTimes(1);
    expect(mockGetKlavisManifests).toHaveBeenCalledTimes(1);
    expect(mockCreateServerAgentToolsEngine).toHaveBeenCalledTimes(1);
  });
});
