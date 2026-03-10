import { describe, expect, it, vi } from 'vitest';

// ==================== Import after mocks ====================
import type { BotCallbackBody } from '../BotCallbackService';
import { BotCallbackService } from '../BotCallbackService';

// ==================== Hoisted mocks ====================

const mockFindByPlatformAndAppId = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockDecrypt = vi.hoisted(() => vi.fn());
const mockFindById = vi.hoisted(() => vi.fn());
const mockTopicUpdate = vi.hoisted(() => vi.fn());
const mockGenerateTopicTitle = vi.hoisted(() => vi.fn());

// Discord REST mock methods
const mockDiscordEditMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDiscordTriggerTyping = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDiscordRemoveOwnReaction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDiscordCreateMessage = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-msg' }));
const mockDiscordUpdateChannelName = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Telegram REST mock methods
const mockTelegramSendMessage = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 12345 }));
const mockTelegramEditMessageText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTelegramRemoveMessageReaction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTelegramSendChatAction = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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

vi.mock('@/server/services/systemAgent', () => ({
  SystemAgentService: vi.fn().mockImplementation(() => ({
    generateTopicTitle: mockGenerateTopicTitle,
  })),
}));

vi.mock('../discordRestApi', () => ({
  DiscordRestApi: vi.fn().mockImplementation(() => ({
    createMessage: mockDiscordCreateMessage,
    editMessage: mockDiscordEditMessage,
    removeOwnReaction: mockDiscordRemoveOwnReaction,
    triggerTyping: mockDiscordTriggerTyping,
    updateChannelName: mockDiscordUpdateChannelName,
  })),
}));

vi.mock('../telegramRestApi', () => ({
  TelegramRestApi: vi.fn().mockImplementation(() => ({
    editMessageText: mockTelegramEditMessageText,
    removeMessageReaction: mockTelegramRemoveMessageReaction,
    sendChatAction: mockTelegramSendChatAction,
    sendMessage: mockTelegramSendMessage,
  })),
}));

// ==================== Helpers ====================

const FAKE_DB = {} as any;
const FAKE_BOT_TOKEN = 'fake-bot-token-123';
const FAKE_CREDENTIALS = JSON.stringify({ botToken: FAKE_BOT_TOKEN });

function setupCredentials(credentials = FAKE_CREDENTIALS) {
  mockFindByPlatformAndAppId.mockResolvedValue({ credentials });
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

    it('should throw when credentials have no botToken', async () => {
      const noTokenCreds = JSON.stringify({ someOtherKey: 'value' });
      setupCredentials(noTokenCreds);

      const body = makeBody({ type: 'step' });

      await expect(service.handleCallback(body)).rejects.toThrow(
        'Bot credentials incomplete for discord appId=app-123',
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

      expect(mockDiscordEditMessage).toHaveBeenCalled();
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

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-id',
        'progress-msg-1',
        expect.any(String),
      );
    });

    it('should route completion type to handleCompletion', async () => {
      const body = makeBody({
        lastAssistantContent: 'Here is the answer.',
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-id',
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

      expect(mockDiscordEditMessage).not.toHaveBeenCalled();
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

      expect(mockDiscordEditMessage).toHaveBeenCalledTimes(1);
      expect(mockDiscordTriggerTyping).toHaveBeenCalledTimes(1);
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

      expect(mockDiscordEditMessage).toHaveBeenCalledTimes(1);
      expect(mockDiscordTriggerTyping).not.toHaveBeenCalled();
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

      expect(mockDiscordEditMessage).toHaveBeenCalledTimes(1);
      expect(mockDiscordTriggerTyping).toHaveBeenCalledTimes(1);
    });

    it('should not throw when edit message fails during step', async () => {
      mockDiscordEditMessage.mockRejectedValueOnce(new Error('Discord API error'));

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

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-id',
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

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-id',
        'progress-msg-1',
        expect.stringContaining('Agent execution failed'),
      );
    });

    it('should skip when no lastAssistantContent on successful completion', async () => {
      const body = makeBody({
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockDiscordEditMessage).not.toHaveBeenCalled();
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

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-id',
        'progress-msg-1',
        expect.stringContaining('The answer is 42.'),
      );
    });

    it('should not throw when editing completion message fails', async () => {
      mockDiscordEditMessage.mockRejectedValueOnce(new Error('Edit failed'));

      const body = makeBody({
        lastAssistantContent: 'Some response',
        reason: 'completed',
        type: 'completion',
      });

      await expect(service.handleCallback(body)).resolves.toBeUndefined();
    });
  });

  // ==================== Message splitting ====================

  describe('message splitting', () => {
    it('should split long Discord messages into multiple chunks', async () => {
      // Default Discord limit is 1800 chars (from splitMessage default)
      const longContent = 'A'.repeat(3000);

      const body = makeBody({
        lastAssistantContent: longContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      // First chunk via editMessage, additional chunks via createMessage
      expect(mockDiscordEditMessage).toHaveBeenCalledTimes(1);
      expect(mockDiscordCreateMessage).toHaveBeenCalled();
    });

    it('should use Telegram char limit (4000) for Telegram platform', async () => {
      // Content just over default 1800 but under 4000 should NOT split for Telegram
      const mediumContent = 'B'.repeat(2500);

      const body = makeTelegramBody({
        lastAssistantContent: mediumContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      // Should be single message (4000 limit), so only editMessage
      expect(mockTelegramEditMessageText).toHaveBeenCalledTimes(1);
      expect(mockTelegramSendMessage).not.toHaveBeenCalled();
    });

    it('should split Telegram messages that exceed 4000 chars', async () => {
      const longContent = 'C'.repeat(6000);

      const body = makeTelegramBody({
        lastAssistantContent: longContent,
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      expect(mockTelegramEditMessageText).toHaveBeenCalledTimes(1);
      expect(mockTelegramSendMessage).toHaveBeenCalled();
    });
  });

  // ==================== Eyes reaction removal ====================

  describe('removeEyesReaction', () => {
    it('should remove eyes reaction on completion for Discord', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'user-msg-1',
      });

      await service.handleCallback(body);

      // Discord uses a separate DiscordRestApi instance for reaction removal
      expect(mockDiscordRemoveOwnReaction).toHaveBeenCalled();
    });

    it('should use reactionChannelId when provided for Discord', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reactionChannelId: 'parent-channel-id',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'user-msg-1',
      });

      await service.handleCallback(body);

      expect(mockDiscordRemoveOwnReaction).toHaveBeenCalledWith(
        'parent-channel-id',
        'user-msg-1',
        '👀',
      );
    });

    it('should skip reaction removal when no userMessageId', async () => {
      const body = makeBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
      });

      await service.handleCallback(body);

      // removeReaction should not be called
      expect(mockDiscordRemoveOwnReaction).not.toHaveBeenCalled();
    });

    it('should remove reaction for Telegram using messenger', async () => {
      const body = makeTelegramBody({
        lastAssistantContent: 'Done.',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'telegram:chat-456:789',
      });

      await service.handleCallback(body);

      // Telegram uses messenger.removeReaction which calls removeMessageReaction
      expect(mockTelegramRemoveMessageReaction).toHaveBeenCalledWith('chat-456', 789);
    });

    it('should not throw when reaction removal fails', async () => {
      mockDiscordRemoveOwnReaction.mockRejectedValueOnce(new Error('Reaction not found'));

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

      // summarizeTopicTitle is fire-and-forget; wait for promises to settle
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

    it('should update thread name on Discord after generating title', async () => {
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
        expect(mockDiscordUpdateChannelName).toHaveBeenCalledWith('thread-id', 'New Title');
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
      expect(mockDiscordUpdateChannelName).not.toHaveBeenCalled();
    });
  });

  // ==================== Discord channel ID extraction ====================

  describe('Discord channel ID extraction', () => {
    it('should extract channel ID from 3-part platformThreadId (no thread)', async () => {
      const body = makeBody({
        platformThreadId: 'discord:guild:channel-123',
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'channel-123',
        expect.any(String),
        expect.any(String),
      );
    });

    it('should extract thread ID (4th part) as channel when thread exists', async () => {
      const body = makeBody({
        platformThreadId: 'discord:guild:parent-channel:thread-456',
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockDiscordEditMessage).toHaveBeenCalledWith(
        'thread-456',
        expect.any(String),
        expect.any(String),
      );
    });
  });

  // ==================== Telegram chat ID and message ID ====================

  describe('Telegram message handling', () => {
    it('should extract chat ID from platformThreadId', async () => {
      const body = makeTelegramBody({
        shouldContinue: true,
        stepType: 'call_llm',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockTelegramEditMessageText).toHaveBeenCalledWith(
        'chat-456',
        expect.any(Number),
        expect.any(String),
      );
    });

    it('should parse composite message ID for Telegram', async () => {
      const body = makeTelegramBody({
        lastAssistantContent: 'Done.',
        progressMessageId: 'telegram:chat-456:99',
        reason: 'completed',
        type: 'completion',
        userMessageId: 'telegram:chat-456:100',
      });

      await service.handleCallback(body);

      // editMessageText should receive parsed numeric message ID
      expect(mockTelegramEditMessageText).toHaveBeenCalledWith('chat-456', 99, expect.any(String));
    });

    it('should trigger typing for Telegram steps', async () => {
      const body = makeTelegramBody({
        shouldContinue: true,
        stepType: 'call_tool',
        type: 'step',
      });

      await service.handleCallback(body);

      expect(mockTelegramSendChatAction).toHaveBeenCalledWith('chat-456', 'typing');
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
      expect(mockDiscordEditMessage).toHaveBeenCalled();

      // Reaction removal
      expect(mockDiscordRemoveOwnReaction).toHaveBeenCalled();

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

      expect(mockDiscordRemoveOwnReaction).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });
});
