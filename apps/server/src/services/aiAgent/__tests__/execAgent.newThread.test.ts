import { ThreadType } from '@lobechat/types';
import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Use vi.hoisted to ensure mock functions are available before vi.mock runs
const { mockMessageCreate, mockSpineMessageId, mockThreadCreate } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockSpineMessageId: vi.fn(),
  mockThreadCreate: vi.fn(),
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
    getLatestNonToolMessageId: vi.fn().mockResolvedValue(undefined),
    getLatestSpineMessageId: mockSpineMessageId,
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
    appendRunningOperationChild: vi.fn().mockResolvedValue(true),
    releaseTaskCallbackReservation: vi.fn().mockResolvedValue(undefined),
    tryReserveTaskCallback: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(undefined),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock ThreadModel
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: mockThreadCreate,
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

describe('AiAgentService.execAgent - appContext.newThread', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  const newThread = { sourceMessageId: 'msg-source', type: ThreadType.Continuation } as const;

  const messageCall = (role: 'user' | 'assistant') =>
    mockMessageCreate.mock.calls.find((call) => call[0].role === role);

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockClear();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockSpineMessageId.mockReset().mockResolvedValue(undefined);
    mockThreadCreate.mockReset().mockResolvedValue({ id: 'thread-new' });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    mockMessageCreate.mockClear();
  });

  it('creates the thread and persists the whole turn inside it', async () => {
    // Regression: the gateway send path skips `aiChat.sendMessageInServer`, so
    // `newThread` is the only carrier for the composer's "start a new subtopic"
    // intent. Dropping it persisted the turn onto the topic's main spine — the
    // subtopic collapsed back into the main chat and never reached the sidebar.
    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { newThread, topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(mockThreadCreate).toHaveBeenCalledWith({
      parentThreadId: undefined,
      sourceMessageId: 'msg-source',
      title: undefined,
      topicId: 'topic-1',
      type: ThreadType.Continuation,
    });
    expect(result.createdThreadId).toBe('thread-new');
    expect(messageCall('user')![0]).toMatchObject({ threadId: 'thread-new', topicId: 'topic-1' });
    expect(messageCall('assistant')![0]).toMatchObject({
      threadId: 'thread-new',
      topicId: 'topic-1',
    });
  });

  it('anchors the first turn on the branch point instead of the topic spine', async () => {
    // The new thread is empty, so the spine lookup would return the TOPIC's head
    // (or nothing) and fork the turn off the wrong node.
    mockSpineMessageId.mockResolvedValue('msg-topic-head');

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { newThread, topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(messageCall('user')![0].parentId).toBe('msg-source');
  });

  it('ignores newThread when the run already targets an existing thread', async () => {
    const result = await service.execAgent({
      agentId: 'agent-1',
      appContext: { newThread, threadId: 'thread-existing', topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(mockThreadCreate).not.toHaveBeenCalled();
    expect(result.createdThreadId).toBeUndefined();
    expect(messageCall('user')![0]).toMatchObject({ threadId: 'thread-existing' });
  });

  it('rejects a subtopic with no parent topic rather than silently dropping it', async () => {
    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: { newThread },
        prompt: 'Test prompt',
      }),
    ).rejects.toThrow('appContext.newThread requires an existing appContext.topicId');

    expect(mockThreadCreate).not.toHaveBeenCalled();
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it('fails loudly when the thread row could not be created', async () => {
    // `ThreadModel.create` swallows insert conflicts and returns undefined.
    // Falling through would persist the turn to the main spine — the exact bug.
    mockThreadCreate.mockResolvedValue(undefined);

    await expect(
      service.execAgent({
        agentId: 'agent-1',
        appContext: { newThread, topicId: 'topic-1' },
        prompt: 'Test prompt',
      }),
    ).rejects.toThrow('Failed to create thread on topic topic-1');

    expect(mockMessageCreate).not.toHaveBeenCalled();
  });
});
