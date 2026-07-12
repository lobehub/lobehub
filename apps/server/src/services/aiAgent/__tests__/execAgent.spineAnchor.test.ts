import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

const { mockGetLatestNonToolMessageId, mockGetLatestSpineMessageId, mockMessageCreate } =
  vi.hoisted(() => ({
    mockGetLatestNonToolMessageId: vi.fn(),
    mockGetLatestSpineMessageId: vi.fn(),
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
    getLatestNonToolMessageId: mockGetLatestNonToolMessageId,
    getLatestSpineMessageId: mockGetLatestSpineMessageId,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

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

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(undefined),
    updateMetadata: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/database/models/chatGroup', () => ({
  ChatGroupModel: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockResolvedValue(undefined),
    getGroupAgentsWithMeta: vi.fn().mockResolvedValue([]),
  })),
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

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/composio', () => ({
  ComposioService: vi.fn().mockImplementation(() => ({
    getComposioManifests: vi.fn().mockResolvedValue([]),
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

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
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

const userMessageCall = () => mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
const assistantMessageCall = () =>
  mockMessageCreate.mock.calls.find((call) => call[0].role === 'assistant');

/**
 * Regression coverage for LOBE-11489: a user turn persisted with
 * `parentId: undefined` into a non-empty topic becomes a second ROOT. The
 * renderer walks the parentId forest depth-first, so an earlier root's
 * still-growing subtree is emitted before a later root and the newest reply
 * renders ABOVE older messages.
 */
describe('AiAgentService.execAgent - user turn spine anchoring', () => {
  let service: AiAgentService;
  const mockDb = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockImplementation(async (payload: { role: string }) => ({
      id: payload.role === 'user' ? 'user-msg-1' : 'assistant-msg-1',
    }));
    mockGetLatestSpineMessageId.mockResolvedValue(undefined);
    mockGetLatestNonToolMessageId.mockResolvedValue(undefined);

    service = new AiAgentService(mockDb, 'test-user-id');
  });

  it('anchors the user turn on the spine head of an existing topic', async () => {
    mockGetLatestSpineMessageId.mockResolvedValue('spine-head-1');

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(mockGetLatestSpineMessageId).toHaveBeenCalledWith({
      threadId: null,
      topicId: 'topic-1',
    });
    expect(userMessageCall()![0]).toMatchObject({ parentId: 'spine-head-1', role: 'user' });
    // No spine candidate is missing, so the fallback must not be queried.
    expect(mockGetLatestNonToolMessageId).not.toHaveBeenCalled();
  });

  it('falls back to the latest non-tool message when the topic has no spine candidate', async () => {
    mockGetLatestSpineMessageId.mockResolvedValue(undefined);
    mockGetLatestNonToolMessageId.mockResolvedValue('signal-turn-1');

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(mockGetLatestNonToolMessageId).toHaveBeenCalledWith({
      threadId: null,
      topicId: 'topic-1',
    });
    expect(userMessageCall()![0]).toMatchObject({ parentId: 'signal-turn-1', role: 'user' });
  });

  it('leaves the first turn of an empty topic as the single root', async () => {
    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(userMessageCall()![0].parentId).toBeUndefined();
  });

  it('chains the assistant placeholder onto the user turn it just created', async () => {
    mockGetLatestSpineMessageId.mockResolvedValue('spine-head-1');

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(assistantMessageCall()![0]).toMatchObject({
      parentId: 'user-msg-1',
      role: 'assistant',
    });
  });

  it('scopes the anchor lookup to the thread when one is active', async () => {
    mockGetLatestSpineMessageId.mockResolvedValue('thread-spine-1');

    await service.execAgent({
      agentId: 'agent-1',
      appContext: { threadId: 'thread-123', topicId: 'topic-1' },
      prompt: 'Test prompt',
    });

    expect(mockGetLatestSpineMessageId).toHaveBeenCalledWith({
      threadId: 'thread-123',
      topicId: 'topic-1',
    });
    expect(userMessageCall()![0]).toMatchObject({ parentId: 'thread-spine-1' });
  });
});
