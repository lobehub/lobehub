import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockCreateOperation, mockGetAgentConfig, mockMessageCreate } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockGetAgentConfig: vi.fn(),
  mockMessageCreate: vi.fn(),
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
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
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
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

describe('AiAgentService.execAgent - builtin agent runtime config', () => {
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
    service = new AiAgentService(mockDb, userId);
  });

  it('should merge runtime systemRole for inbox agent when DB systemRole is empty', async () => {
    // Inbox agent with no user-customized systemRole in DB
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: '', // empty in DB
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    // Verify createOperation was called with agentConfig containing the runtime systemRole
    expect(mockCreateOperation).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toContain('You are Lobe');
    expect(callArgs.agentConfig.systemRole).toContain('{{model}}');
  });

  it('should NOT override user-customized systemRole for inbox agent', async () => {
    const customSystemRole = 'You are a custom assistant.';
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-inbox',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'inbox',
      systemRole: customSystemRole, // user has customized
    });

    await service.execAgent({
      agentId: 'agent-inbox',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe(customSystemRole);
  });

  it('should not apply runtime config for non-builtin agents', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-custom',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      slug: 'my-custom-slug', // not a builtin slug
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-custom',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    // Should remain empty - no runtime config applied
    expect(callArgs.agentConfig.systemRole).toBe('');
  });

  it('should not apply runtime config for agents without slug', async () => {
    mockGetAgentConfig.mockResolvedValue({
      chatConfig: {},
      id: 'agent-no-slug',
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: '',
    });

    await service.execAgent({
      agentId: 'agent-no-slug',
      prompt: 'Hello',
    });

    const callArgs = mockCreateOperation.mock.calls[0][0];
    expect(callArgs.agentConfig.systemRole).toBe('');
  });
});
