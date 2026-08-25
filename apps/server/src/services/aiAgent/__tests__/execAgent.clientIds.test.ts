import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Use vi.hoisted to ensure mock functions are available before vi.mock runs
const { mockMessageCreate, mockTopicCreate } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockTopicCreate: vi.fn(),
}));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    // Resume validation reads the parent message and asserts topic ownership.
    findById: vi.fn().mockResolvedValue({
      id: 'msg_parent00001',
      role: 'assistant',
      topicId: 'topic-1',
    }),
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock AgentModel
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
    queryAgents: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock AgentService
vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

// Mock PluginModel
vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock TopicModel
vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: mockTopicCreate,
    findById: vi.fn().mockResolvedValue(undefined),
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock ThreadModel
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

// Mock ChatGroupModel — execAgent resolves the operation's group context when
// appContext.groupId is set (SubAgent task scenario). An empty roster makes
// buildGroupAgentContext return undefined, so the run proceeds without a group.
vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue(undefined),
    getGroupAgentsWithMeta: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock AgentRuntimeService
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

// Mock MarketService (for getLobehubSkillManifests)
vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock ComposioService (for getComposioManifests)
vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock FileService
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

// Mock Mecha modules
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

// Mock deviceGateway
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

// Mock model-bank
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

describe('AiAgentService.execAgent - client-minted ids', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  const clientIds = {
    assistantMessageId: 'msg_clientAsst01',
    topicId: 'tpc_clientMinted1',
    userMessageId: 'msg_clientUser01',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockClear();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockTopicCreate.mockClear();
    mockTopicCreate.mockImplementation(async (_params: unknown, id?: string) => ({
      id: id ?? 'topic-server-minted',
    }));

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    mockMessageCreate.mockClear();
    mockTopicCreate.mockClear();
  });

  it('should forward client-minted ids to topic and message creation on a fresh send', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      clientIds,
      prompt: 'Fresh send',
    });

    // Topic created under the client id — the sidebar row the client already
    // renders never has to change id.
    expect(mockTopicCreate).toHaveBeenCalledWith(expect.any(Object), 'tpc_clientMinted1');

    const userCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
    const assistantCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'assistant');
    expect(userCall?.[1]).toBe('msg_clientUser01');
    expect(assistantCall?.[1]).toBe('msg_clientAsst01');
  });

  it('should mint server ids when no client ids are supplied', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      prompt: 'Old client shape',
    });

    expect(mockTopicCreate).toHaveBeenCalledWith(expect.any(Object), undefined);
    const userCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
    const assistantCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'assistant');
    expect(userCall?.[1]).toBeUndefined();
    expect(assistantCall?.[1]).toBeUndefined();
  });

  it('should drop client ids on a resume-like replay', async () => {
    // A regeneration/resume reaches execAgent with parentMessageId set. If the
    // replay carried the original send's ids, honouring them would collide
    // with the rows that send already created — the service must drop them
    // rather than trust every caller to omit them.
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      clientIds,
      parentMessageId: 'msg_parent00001',
      prompt: 'Regenerate',
      resume: true,
    });

    const assistantCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'assistant');
    expect(assistantCall).toBeDefined();
    expect(assistantCall?.[1]).toBeUndefined();
  });
});
