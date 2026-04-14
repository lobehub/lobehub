import { describe, expect, it, vi } from 'vitest';

import type { BotCallbackBody } from '../BotCallbackService';
import { BotCallbackService } from '../BotCallbackService';

// ==================== Hoisted mocks ====================

const mockFindByPlatformAndAppId = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockFindById = vi.hoisted(() => vi.fn());
const mockTopicUpdate = vi.hoisted(() => vi.fn());
const mockGenerateTopicTitle = vi.hoisted(() => vi.fn());

// Unified messenger mock methods (used by all platforms via PlatformClient)
const mockEditMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTriggerTyping = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRemoveReaction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateMessage = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-msg' }));
const mockUpdateThreadName = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Mock PlatformClient's getMessenger
const mockGetMessenger = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    createMessage: mockCreateMessage,
    editMessage: mockEditMessage,
    removeReaction: mockRemoveReaction,
    triggerTyping: mockTriggerTyping,
    updateThreadName: mockUpdateThreadName,
  })),
);

const mockCreateBot = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    applicationId: 'mock-app',
    createAdapter: () => ({}),
    extractChatId: (id: string) => id,
    getMessenger: mockGetMessenger,
    parseMessageId: (id: string) => id,
    id: 'mock',
    start: vi.fn(),
    stop: vi.fn(),
  })),
);

// ==================== vi.mock ====================

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findByPlatformAndAppId: mockFindByPlatformAndAppId,
  },
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    findById: mockFindById,
    update: mockTopicUpdate,
  })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));

vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: {
    clearActiveThread: vi.fn(),
  },
}));

vi.mock('@/server/services/gateway/MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn().mockReturnValue({
    isConfigured: false,
    isEnabled: false,
    startTyping: vi.fn().mockResolvedValue(undefined),
    stopTyping: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(() => ({
    generateTopicTitle: mockGenerateTopicTitle,
  })),
}));

vi.mock('../platforms', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    platformRegistry: {
      getPlatform: vi.fn().mockImplementation((platform: string) => {
        if (platform === 'unknown') return undefined;
        return {
          clientFactory: { createClient: mockCreateBot },
          credentials: [],
          name: platform,
          id: platform,
          schema: [],
        };
      }),
    },
  };
});

// ==================== Helpers ====================

const FAKE_DB = {} as any;
const FAKE_BOT_TOKEN = 'fake-bot-token-123';
const FAKE_CREDENTIALS = JSON.stringify({ botToken: FAKE_BOT_TOKEN });

function setupCredentials(credentials = FAKE_CREDENTIALS, extra?: Record<string, unknown>) {
  mockFindByPlatformAndAppId.mockResolvedValue({ credentials, ...extra });
  mockInitWithEnvKey.mockResolvedValue({ decrypt: mockDecrypt });
  mockDecrypt.mockResolvedValue({ plaintext: credentials });
}

function makeBody(overrides: Partial<BotCallbackBody> = {}): BotCallbackBody {
  return {
    applicationId: 'app-123',
    platformThreadId: 'discord:guild:channel-id',
    progressMessageId: 'progress-msg-1',
    type: 'step',
    ...overrides,
  };
}

function makeTelegramBody(overrides: Partial<BotCallbackBody> = {}): BotCallbackBody {
  return makeBody({
    platformThreadId: 'telegram:chat-456',
    ...overrides,
  });
}

// ==================== Tests ====================

describe('BotCallbackService', () => {
  let service: BotCallbackService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BotCallbackService(FAKE_DB);
    setupCredentials();

    // Default: getMessenger returns the main messenger mock
    mockGetMessenger.mockImplementation(() => ({
      createMessage: mockCreateMessage,
      editMessage: mockEditMessage,
      removeReaction: mockRemoveReaction,
      triggerTyping: mockTriggerTyping,
      updateThreadName: mockUpdateThreadName,
    }));
  });

  // ==================== Platform detection ====================

  describe('platform detection from platformThreadId', () => {
    it('should detect discord platform from platformThreadId prefix', async () => {
      const body = makeBody({
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockFindByPlatformAndAppId).toHaveBeenCalledWith(FAKE_DB, 'discord', 'app-123');
    });

    it('should detect telegram platform from platformThreadId prefix', async () => {
      const body = makeTelegramBody({
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockFindByPlatformAndAppId).toHaveBeenCalledWith(FAKE_DB, 'telegram', 'app-123');
    });
  });

  // ==================== Messenger creation errors ====================

  describe('messenger creation failures', () => {
    it('should throw when bot provider not found', async () => {
      mockFindByPlatformAndAppId.mockResolvedValue(null);

      const body = makeBody({ type: 'step' });

      await expect(service.handleCallback(body)).rejects.toThrow(
        'Bot provider not found for discord appId=app-123',
      );
    });

    it('should fall back to raw credentials when decryption fails', async () => {
      mockFindByPlatformAndAppId.mockResolvedValue({ credentials: FAKE_CREDENTIALS });
      mockInitWithEnvKey.mockResolvedValue({
        decrypt: vi.fn().mockRejectedValue(new Error('decrypt failed')),
      });

      const body = makeBody({
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      // Should not throw because it falls back to raw JSON parse
      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalled();
    });
  });

  // ==================== handleCallback routing ====================

  describe('handleCallback routing', () => {
    it('should route step type to handleStep', async () => {
      const body = makeBody({
        content: 'Thinking...',
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith('progress-msg-1', expect.any(String));
    });

    it('should route completion type to handleCompletion', async () => {
      const body = makeBody({
        lastAssistantContent: 'Here is the answer.',
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('Here is the answer.'),
      );
    });
  });

  // ==================== Step handling ====================

  describe('step handling', () => {
    it('should skip step processing when shouldContinue is false', async () => {
      const body = makeBody({
        shouldContinue: false,
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).not.toHaveBeenCalled();
    });

    it('should edit progress message and trigger typing for non-final LLM step', async () => {
      const body = makeBody({
        content: 'Processing...',
        shouldContinue: true,
        stepType: 'call_llm',
        toolsCalling: [{ apiName: 'search', arguments: '{}', identifier: 'web' }],
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockTriggerTyping).toHaveBeenCalledTimes(1);
    });

    it('should NOT trigger typing for final LLM response (no tool calls + has content)', async () => {
      const body = makeBody({
        content: 'Final answer here',
        shouldContinue: true,
        stepType: 'call_llm',
        toolsCalling: [],
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockTriggerTyping).not.toHaveBeenCalled();
    });

    it('should handle tool step type', async () => {
      const body = makeBody({
        lastToolsCalling: [{ apiName: 'search', identifier: 'web' }],
        shouldContinue: true,
        stepType: 'call_tool',
        toolsResult: [{ apiName: 'search', identifier: 'web', output: 'result data' }],
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockTriggerTyping).toHaveBeenCalledTimes(1);
    });

    it('should not throw when edit message fails during step', async () => {
      mockEditMessage.mockRejectedValueOnce(new Error('API error'));

      const body = makeBody({
        content: 'Processing...',
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      // Should not throw - error is logged but swallowed
      await expect(service.handleCallback(body)).resolves.toBeUndefined();
    });
  });

  // ==================== Completion handling ====================

  describe('completion handling', () => {
    it('should render error message when reason is error', async () => {
      const body = makeBody({
        errorMessage: 'Model quota exceeded',
        reason: 'error',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('Model quota exceeded'),
      );
    });

    it('should use default error message when errorMessage is not provided', async () => {
      const body = makeBody({
        reason: 'error',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('Agent execution failed'),
      );
    });

    it('should render stopped message when reason is interrupted', async () => {
      const body = makeBody({
        lastAssistantContent: 'Partial answer that should not be shown',
        reason: 'interrupted',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockCreateMessage).toHaveBeenCalledWith('Execution stopped.');
      expect(mockEditMessage).not.toHaveBeenCalled();
    });

    it('should render custom stopped message when interrupted has errorMessage', async () => {
      const body = makeBody({
        errorMessage: 'Execution stopped by user.',
        lastAssistantContent: 'Partial answer that should not be shown',
        reason: 'interrupted',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockCreateMessage).toHaveBeenCalledWith('Execution stopped by user.');
      expect(mockEditMessage).not.toHaveBeenCalled();
    });

    it('should skip when no lastAssistantContent on successful completion', async () => {
      const body = makeBody({
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).not.toHaveBeenCalled();
    });

    it('should edit progress message with final reply content', async () => {
      const body = makeBody({
        cost: 0.005,
        duration: 3000,
        lastAssistantContent: 'The answer is 42.',
        llmCalls: 2,
        reason: 'completed',
        toolCalls: 1,
        totalTokens: 1500,
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('The answer is 42.'),
      );
    });

    it('should not throw when editing completion message fails', async () => {
      mockEditMessage.mockRejectedValueOnce(new Error('Edit failed'));

      const body = makeBody({
        lastAssistantContent: 'Some response',
        reason: 'completed',
        type: 'completion',
      });

      await expect(service.handleCallback(body)).resolves.toBeUndefined();
    });

    it('should not throw when sending interrupted message fails', async () => {
      mockCreateMessage.mockRejectedValueOnce(new Error('Send failed'));

      const body = makeBody({
        reason: 'interrupted',
        type: 'completion',
      });

      await expect(service.handleCallback(body)).resolves.toBeUndefined();
    });
  });

  // ==================== Message splitting ====================

  describe('message splitting', () => {
    it('should split long messages into multiple chunks', async () => {
      const longContent = 'A'.repeat(3000);

      const body = makeBody({
        lastAssistantContent: longContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      // First chunk via editMessage, additional chunks via createMessage
      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockCreateMessage).toHaveBeenCalled();
    });

    it('should use custom charLimit from provider settings', async () => {
      setupCredentials(FAKE_CREDENTIALS, { settings: { charLimit: 4000 } });

      // Content just over default 1800 but under 4000 should NOT split
      const mediumContent = 'B'.repeat(2500);

      const body = makeTelegramBody({
        lastAssistantContent: mediumContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      // Should be single message (4000 limit), so only editMessage
      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it('should split messages that exceed custom charLimit', async () => {
      setupCredentials(FAKE_CREDENTIALS, { settings: { charLimit: 4000 } });
      const longContent = 'C'.repeat(6000);

      const body = makeTelegramBody({
        lastAssistantContent: longContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledTimes(1);
      expect(mockCreateMessage).toHaveBeenCalled();
    });
  });

  // ==================== Eyes reaction removal ====================

  describe('removeEyesReaction', () => {
    it('should remove eyes reaction on completion', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'user-msg-1',
      });

      await service.handleCallback(body);

      expect(mockRemoveReaction).toHaveBeenCalledWith('user-msg-1', '👀');
    });

    it('should skip reaction removal when no userMessageId', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockRemoveReaction).not.toHaveBeenCalled();
    });

    it('should remove reaction for Telegram using messenger', async () => {
      const body = makeTelegramBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'telegram:chat-456:789',
      });

      await service.handleCallback(body);

      expect(mockRemoveReaction).toHaveBeenCalledWith('telegram:chat-456:789', '👀');
    });

    it('should not throw when reaction removal fails', async () => {
      mockRemoveReaction.mockRejectedValueOnce(new Error('Reaction not found'));

      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'user-msg-1',
      });

      await expect(service.handleCallback(body)).resolves.toBeUndefined();
    });
  });

  // ==================== Topic title summarization ====================

  describe('topic title summarization', () => {
    it('should summarize topic title on successful completion', async () => {
      mockFindById.mockResolvedValue({ title: null });
      mockGenerateTopicTitle.mockResolvedValue('Generated Topic Title');
      mockTopicUpdate.mockResolvedValue(undefined);

      const body = makeBody({
        lastAssistantContent: 'Here is the answer.',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'What is the meaning of life?',
      });

      await service.handleCallback(body);

      await vi.waitFor(() => {
        expect(mockFindById).toHaveBeenCalledWith('topic-1');
      });

      await vi.waitFor(() => {
        expect(mockGenerateTopicTitle).toHaveBeenCalledWith({
          lastAssistantContent: 'Here is the answer.',
          userPrompt: 'What is the meaning of life?',
        });
      });

      await vi.waitFor(() => {
        expect(mockTopicUpdate).toHaveBeenCalledWith('topic-1', {
          title: 'Generated Topic Title',
        });
      });
    });

    it('should not summarize when topic already has a title', async () => {
      mockFindById.mockResolvedValue({ title: 'Existing Title' });

      const body = makeBody({
        lastAssistantContent: 'Here is the answer.',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'What is the meaning of life?',
      });

      await service.handleCallback(body);

      await vi.waitFor(() => {
        expect(mockFindById).toHaveBeenCalledWith('topic-1');
      });

      expect(mockGenerateTopicTitle).not.toHaveBeenCalled();
    });

    it('should skip summarization when reason is error', async () => {
      const body = makeBody({
        errorMessage: 'Failed',
        lastAssistantContent: 'partial',
        reason: 'error',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'test',
      });

      await service.handleCallback(body);

      // Wait a tick to ensure no async work was started
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should skip summarization when reason is interrupted', async () => {
      const body = makeBody({
        lastAssistantContent: 'partial',
        reason: 'interrupted',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'test',
      });

      await service.handleCallback(body);

      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockGenerateTopicTitle).not.toHaveBeenCalled();
      expect(mockTopicUpdate).not.toHaveBeenCalled();
    });

    it('should skip summarization when topicId is missing', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'test',
      });

      await service.handleCallback(body);

      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should skip summarization when userId is missing', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userPrompt: 'test',
      });

      await service.handleCallback(body);

      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('should update thread name after generating title', async () => {
      mockFindById.mockResolvedValue({ title: null });
      mockGenerateTopicTitle.mockResolvedValue('New Title');
      mockTopicUpdate.mockResolvedValue(undefined);

      const body = makeBody({
        lastAssistantContent: 'Answer.',
        platformThreadId: 'discord:guild:channel-id:thread-id',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'Question?',
      });

      await service.handleCallback(body);

      await vi.waitFor(() => {
        expect(mockUpdateThreadName).toHaveBeenCalledWith('New Title');
      });
    });

    it('should not update thread name when generated title is empty', async () => {
      mockFindById.mockResolvedValue({ title: null });
      mockGenerateTopicTitle.mockResolvedValue('');
      mockTopicUpdate.mockResolvedValue(undefined);

      const body = makeBody({
        lastAssistantContent: 'Answer.',
        platformThreadId: 'discord:guild:channel-id:thread-id',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'Question?',
      });

      await service.handleCallback(body);

      // Wait for async chain
      await new Promise((r) => setTimeout(r, 50));
      expect(mockTopicUpdate).not.toHaveBeenCalled();
      expect(mockUpdateThreadName).not.toHaveBeenCalled();
    });
  });

  // ==================== Completion + reaction + summarization flow ====================

  describe('full completion flow', () => {
    it('should execute completion, reaction removal, and topic summarization', async () => {
      mockFindById.mockResolvedValue({ title: null });
      mockGenerateTopicTitle.mockResolvedValue('Summary Title');
      mockTopicUpdate.mockResolvedValue(undefined);

      const body = makeBody({
        cost: 0.01,
        lastAssistantContent: 'Complete answer.',
        reason: 'completed',
        topicId: 'topic-1',
        type: 'completion',
        userId: 'user-1',
        userMessageId: 'user-msg-1',
        userPrompt: 'Tell me something.',
      });

      await service.handleCallback(body);

      // Completion: edit message
      expect(mockEditMessage).toHaveBeenCalled();

      // Reaction removal
      expect(mockRemoveReaction).toHaveBeenCalled();

      // Topic summarization (async)
      await vi.waitFor(() => {
        expect(mockTopicUpdate).toHaveBeenCalledWith('topic-1', { title: 'Summary Title' });
      });
    });

    it('should not run reaction removal or summarization for step type', async () => {
      const body = makeBody({
        shouldContinue: true,
        stepType: 'call_llm',
        topicId: 'topic-1',
        type: 'step',
        userId: 'user-1',
        userMessageId: 'user-msg-1',
        userPrompt: 'test',
      });

      await service.handleCallback(body);

      expect(mockRemoveReaction).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });

  describe('hook-based webhook payload compatibility', () => {
    // These tests verify that payloads from HookDispatcher (which include
    // hookId/hookType fields) are handled correctly by BotCallbackService.
    // This is the critical contract between the hooks framework and the bot callback.

    it('should handle step payload with hookId and hookType fields', async () => {
      const body = makeBody({
        content: 'thinking...',
        executionTimeMs: 100,
        hookId: 'bot-step-progress',
        hookType: 'afterStep',
        shouldContinue: true,
        stepType: 'call_llm' as const,
        thinking: true,
        totalCost: 0.01,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalSteps: 1,
        totalTokens: 150,
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith('progress-msg-1', expect.any(String));
    });

    it('should handle completion payload with hookId and hookType fields', async () => {
      const body = makeBody({
        cost: 0.05,
        duration: 5000,
        hookId: 'bot-completion',
        hookType: 'onComplete',
        lastAssistantContent: 'Here is the answer',
        llmCalls: 3,
        reason: 'done',
        toolCalls: 2,
        totalTokens: 500,
        type: 'completion',
        userId: 'user-1',
        userPrompt: 'test question',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('Here is the answer'),
      );
    });

    it('should handle completion error payload from hooks', async () => {
      const body = makeBody({
        errorMessage: 'Rate limit exceeded',
        hookId: 'bot-completion',
        hookType: 'onComplete',
        reason: 'error',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockEditMessage).toHaveBeenCalledWith(
        'progress-msg-1',
        expect.stringContaining('Rate limit exceeded'),
      );
    });
  });
});
