import type * as ModelBankModule from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Use vi.hoisted to ensure mock functions are available before vi.mock runs
const { mockMessageCreate } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
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
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
    findById: vi.fn().mockResolvedValue(undefined),
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

describe('AiAgentService.execAgent - threadId handling', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    // Explicitly clear the shared mock to prevent state pollution between tests
    mockMessageCreate.mockClear();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });

    service = new AiAgentService(mockDb, userId);
  });

  afterEach(() => {
    // Ensure cleanup after each test
    mockMessageCreate.mockClear();
  });

  describe('when threadId is provided in appContext', () => {
    it('should pass threadId when creating user message', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          threadId: 'thread-123',
          topicId: 'topic-1',
        },
        prompt: 'Test prompt',
      });

      // Find the user message creation call
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');

      expect(userMessageCall).toBeDefined();
      expect(userMessageCall![0]).toMatchObject({
        content: 'Test prompt',
        role: 'user',
        threadId: 'thread-123',
        topicId: 'topic-1',
      });
    });

    it('should pass threadId when creating assistant message', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          threadId: 'thread-123',
          topicId: 'topic-1',
        },
        prompt: 'Test prompt',
      });

      // Find the assistant message creation call
      const assistantMessageCall = mockMessageCreate.mock.calls.find(
        (call) => call[0].role === 'assistant',
      );

      expect(assistantMessageCall).toBeDefined();
      expect(assistantMessageCall![0]).toMatchObject({
        role: 'assistant',
        threadId: 'thread-123',
        topicId: 'topic-1',
      });
    });
  });

  describe('when threadId is not provided in appContext', () => {
    it('should create user message without threadId', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          topicId: 'topic-1',
        },
        prompt: 'Test prompt',
      });

      // Find the user message creation call
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');

      expect(userMessageCall).toBeDefined();
      expect(userMessageCall![0].threadId).toBeUndefined();
    });

    it('should create assistant message without threadId', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          topicId: 'topic-1',
        },
        prompt: 'Test prompt',
      });

      // Find the assistant message creation call
      const assistantMessageCall = mockMessageCreate.mock.calls.find(
        (call) => call[0].role === 'assistant',
      );

      expect(assistantMessageCall).toBeDefined();
      expect(assistantMessageCall![0].threadId).toBeUndefined();
    }, 10_000);
  });

  describe('when appContext is undefined', () => {
    it('should create messages without threadId', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        prompt: 'Test prompt',
      });

      // Check all message creation calls
      for (const call of mockMessageCreate.mock.calls) {
        expect(call[0].threadId).toBeUndefined();
      }
    });
  });

  describe('SubAgent task scenario', () => {
    it('should ensure messages are isolated in Thread context', async () => {
      const threadId = 'isolated-thread-456';

      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          groupId: 'group-1',
          threadId,
          topicId: 'topic-1',
        },
        prompt: 'SubAgent task instruction',
      });

      // Verify both user and assistant messages have the correct threadId
      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      const assistantMessageCall = mockMessageCreate.mock.calls.find(
        (call) => call[0].role === 'assistant',
      );

      expect(userMessageCall![0].threadId).toBe(threadId);
      expect(assistantMessageCall![0].threadId).toBe(threadId);

      // Verify groupId is passed to AgentRuntimeService (checked in appContext)
      // This is handled by the createOperation call
    }, 10_000);
  });

  describe('Agent Signal marker attribution', () => {
    it('persists trace messages under the reviewed user agent carried on the marker', async () => {
      // Background self-iteration runs execute under a builtin slug, so the
      // resolved agent ('agent-1') is the builtin agent — but their persisted
      // messages must attribute to the reviewed user agent on `marker.agentId`,
      // matching the operation row + receipts (not the builtin slug).
      await service.execAgent({
        agentId: 'agent-1',
        appContext: {
          agentSignal: { agentId: 'user-agent-9', kind: 'skill', sourceId: 'src-1' },
          topicId: 'topic-1',
        },
        prompt: 'Skill feedback evidence',
      });

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      const assistantMessageCall = mockMessageCreate.mock.calls.find(
        (call) => call[0].role === 'assistant',
      );

      expect(userMessageCall![0].agentId).toBe('user-agent-9');
      expect(assistantMessageCall![0].agentId).toBe('user-agent-9');
    }, 10_000);

    it('falls back to the executing agent id for ordinary runs without a marker', async () => {
      await service.execAgent({
        agentId: 'agent-1',
        appContext: { topicId: 'topic-1' },
        prompt: 'Test prompt',
      });

      const userMessageCall = mockMessageCreate.mock.calls.find((call) => call[0].role === 'user');
      const assistantMessageCall = mockMessageCreate.mock.calls.find(
        (call) => call[0].role === 'assistant',
      );

      expect(userMessageCall![0].agentId).toBe('agent-1');
      expect(assistantMessageCall![0].agentId).toBe('agent-1');
    }, 10_000);
  });
});
