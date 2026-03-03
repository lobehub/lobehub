import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Use vi.hoisted to ensure mock functions are available before vi.mock runs
const { mockMessageCreate, mockMessageQuery, mockCreateOperation } = vi.hoisted(() => ({
  mockCreateOperation: vi.fn(),
  mockMessageCreate: vi.fn(),
  mockMessageQuery: vi.fn(),
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
    query: mockMessageQuery,
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
    create: vi.fn().mockResolvedValue({ id: 'topic-new' }),
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

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
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

describe('AiAgentService.execAgent - topic history loading', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageCreate.mockClear();
    mockMessageQuery.mockClear();
    mockCreateOperation.mockClear();

    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    mockMessageCreate.mockClear();
    mockMessageQuery.mockClear();
    mockCreateOperation.mockClear();
  });

  describe('when topicId is provided (follow-up message in existing thread)', () => {
    it('should load history messages from the topic and include them in initialMessages', async () => {
      // Simulate existing conversation history in the topic
      const existingMessages = [
        { content: '你看得见这个引用吗', id: 'msg-prev-1', role: 'user' },
        { content: '你好！是的，我可以看到你的消息。', id: 'msg-prev-2', role: 'assistant' },
      ];
      mockMessageQuery.mockResolvedValue(existingMessages);

      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-existing' },
        prompt: '你能复述我说的第一句话吗',
      });

      // Verify messageModel.query was called to load history for the topic
      expect(mockMessageQuery).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'topic-existing' }),
      );

      // Verify createOperation received all history messages + the new user message
      expect(mockCreateOperation).toHaveBeenCalled();
      const createOperationArgs = mockCreateOperation.mock.calls[0][0];
      const initialMessages = createOperationArgs.initialMessages;

      // Should contain the 2 history messages + 1 new user message = 3 total
      expect(initialMessages.length).toBe(3);
      expect(initialMessages[0]).toMatchObject({ content: '你看得见这个引用吗', role: 'user' });
      expect(initialMessages[1]).toMatchObject({
        content: '你好！是的，我可以看到你的消息。',
        role: 'assistant',
      });
      expect(initialMessages[2]).toMatchObject({
        content: '你能复述我说的第一句话吗',
        role: 'user',
      });
    });
  });

  describe('when no topicId is provided (first message, new conversation)', () => {
    it('should only include the current user message in initialMessages', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Hello',
      });

      // createOperation should receive only the new user message
      expect(mockCreateOperation).toHaveBeenCalled();
      const createOperationArgs = mockCreateOperation.mock.calls[0][0];
      const initialMessages = createOperationArgs.initialMessages;

      expect(initialMessages.length).toBe(1);
      expect(initialMessages[0]).toMatchObject({ content: 'Hello', role: 'user' });
    });
  });
});
