import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockMessageCreate, mockSpawnHeteroSandbox } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockSpawnHeteroSandbox: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signOperationJwt: vi.fn().mockResolvedValue('op-jwt'),
  signUserJWT: vi.fn().mockResolvedValue('user-jwt'),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

const heteroAgentConfig = {
  agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
  chatConfig: {},
  files: [],
  id: 'agent-1',
  knowledgeBases: [],
  model: 'claude-code',
  plugins: [],
  provider: 'anthropic',
  systemRole: 'You are a helpful assistant',
};

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue(heteroAgentConfig),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

const topicMock = {
  create: vi.fn().mockResolvedValue({ id: 'topic-1', metadata: undefined }),
  findById: vi.fn().mockResolvedValue(undefined),
  updateMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => topicMock),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
    market: {
      creds: {
        get: vi.fn(),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  })),
}));

vi.mock('@/server/services/heterogeneousAgent', () => ({
  HeterogeneousAgentService: vi.fn().mockImplementation(() => ({
    getHeterogeneousResumeSessionId: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/server/services/heterogeneousAgent/sandboxRunner', () => ({
  spawnHeteroSandbox: mockSpawnHeteroSandbox,
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: vi.fn().mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    }),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

describe('AiAgentService.execAgent - hetero early-exit file attachments', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    topicMock.create.mockResolvedValue({ id: 'topic-1', metadata: undefined });
    topicMock.findById.mockResolvedValue(undefined);
    topicMock.updateMetadata.mockResolvedValue(undefined);
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const findUserMessageCreate = () =>
    mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');

  it('should attach fileIds to the user message (SPA gateway device/sandbox mode)', async () => {
    // regression: the hetero early exit used to create the user message
    // without `files`, so images attached in device mode were never linked
    // via messagesFiles and disappeared after the optimistic message was
    // replaced by the server snapshot.
    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-1', 'file-2'],
      prompt: 'Look at this image',
    });

    const userCall = findUserMessageCreate();
    expect(userCall).toBeDefined();
    expect(userCall![0].files).toEqual(['file-1', 'file-2']);
  });

  it('should dedupe repeated fileIds (messagesFiles PK is fileId+messageId)', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      fileIds: ['file-1', 'file-1', 'file-2'],
      prompt: 'Look at this image',
    });

    const userCall = findUserMessageCreate();
    expect(userCall![0].files).toEqual(['file-1', 'file-2']);
  });

  it('should leave files undefined when no fileIds are provided', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'No attachments here',
    });

    const userCall = findUserMessageCreate();
    expect(userCall).toBeDefined();
    expect(userCall![0].files).toBeUndefined();
  });

  it('should leave files undefined when fileIds is an empty array', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      fileIds: [],
      prompt: 'No attachments here',
    });

    const userCall = findUserMessageCreate();
    expect(userCall![0].files).toBeUndefined();
  });
});
