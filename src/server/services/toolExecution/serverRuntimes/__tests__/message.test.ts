import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

// ==================== Mocks ====================

const mockQuery = vi.fn();

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn().mockImplementation(() => ({
    query: mockQuery,
  })),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({}),
  },
}));

// Mock platform API constructors
const mockDiscordCreateMessage = vi.fn();
const mockDiscordGetMessages = vi.fn();
const mockDiscordEditMessage = vi.fn();
const mockDiscordDeleteMessage = vi.fn();

vi.mock('@/server/services/bot/platforms/discord/api', () => ({
  DiscordApi: vi.fn().mockImplementation(() => ({
    createMessage: mockDiscordCreateMessage,
    createPoll: vi.fn(),
    createReaction: vi.fn(),
    deleteMessage: mockDiscordDeleteMessage,
    editMessage: mockDiscordEditMessage,
    getChannel: vi.fn(),
    getGuildChannels: vi.fn(),
    getGuildMember: vi.fn(),
    getMessages: mockDiscordGetMessages,
    getPinnedMessages: vi.fn(),
    getReactions: vi.fn(),
    listActiveThreads: vi.fn(),
    pinMessage: vi.fn(),
    searchGuildMessages: vi.fn(),
    startThreadFromMessage: vi.fn(),
    startThreadWithoutMessage: vi.fn(),
    unpinMessage: vi.fn(),
  })),
}));

const mockTelegramSendMessage = vi.fn();
vi.mock('@/server/services/bot/platforms/telegram/api', () => ({
  TelegramApi: vi.fn().mockImplementation(() => ({
    deleteMessage: vi.fn(),
    editMessageText: vi.fn(),
    getChat: vi.fn(),
    getChatMember: vi.fn(),
    createForumTopic: vi.fn(),
    pinChatMessage: vi.fn(),
    sendMessage: mockTelegramSendMessage,
    sendMessageToTopic: vi.fn(),
    sendPoll: vi.fn(),
    setMessageReaction: vi.fn(),
    unpinChatMessage: vi.fn(),
  })),
}));

const mockSlackPostMessage = vi.fn();
vi.mock('@/server/services/bot/platforms/slack/api', () => ({
  SlackApi: vi.fn().mockImplementation(() => ({
    addReaction: vi.fn(),
    deleteMessage: vi.fn(),
    getChannelInfo: vi.fn(),
    getHistory: vi.fn(),
    getReactions: vi.fn(),
    listChannels: vi.fn(),
    listPins: vi.fn(),
    pinMessage: vi.fn(),
    postMessage: mockSlackPostMessage,
    postMessageInThread: vi.fn(),
    removeReaction: vi.fn(),
    search: vi.fn(),
    unpinMessage: vi.fn(),
    updateMessage: vi.fn(),
    getUserInfo: vi.fn(),
    getReplies: vi.fn(),
  })),
}));

const mockFeishuSendMessage = vi.fn();
vi.mock('@lobechat/chat-adapter-feishu', () => ({
  LarkApiClient: vi.fn().mockImplementation(() => ({
    addReaction: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    getChatInfo: vi.fn(),
    getUserInfo: vi.fn(),
    listMessages: vi.fn(),
    replyMessage: vi.fn(),
    sendMessage: mockFeishuSendMessage,
  })),
}));

const mockQQSendGroupMessage = vi.fn();
vi.mock('@lobechat/chat-adapter-qq', () => ({
  QQApiClient: vi.fn().mockImplementation(() => ({
    sendC2CMessage: vi.fn(),
    sendDmsMessage: vi.fn(),
    sendGroupMessage: mockQQSendGroupMessage,
    sendGuildMessage: vi.fn(),
  })),
}));

// Import after mocks
const { messageRuntime } = await import('../message');

// ==================== Helpers ====================

const validContext: ToolExecutionContext = {
  serverDB: {} as any,
  toolManifestMap: {},
  userId: 'user-1',
};

const mockProviderFor = (platform: string, credentials: Record<string, string>) => {
  mockQuery.mockImplementation(async (params?: { platform?: string }) => {
    if (params?.platform === platform) {
      return [{ applicationId: 'app-1', credentials, enabled: true }];
    }
    return [];
  });
};

// ==================== Tests ====================

describe('messageRuntime', () => {
  it('should have correct identifier', () => {
    expect(messageRuntime.identifier).toBe(MessageToolIdentifier);
  });

  describe('factory', () => {
    it('should throw when serverDB is missing', async () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      await expect(messageRuntime.factory(context)).rejects.toThrow(
        'serverDB is required for Message tool execution',
      );
    });

    it('should throw when userId is missing', async () => {
      const context: ToolExecutionContext = {
        serverDB: {} as any,
        toolManifestMap: {},
      };

      await expect(messageRuntime.factory(context)).rejects.toThrow(
        'userId is required for Message tool execution',
      );
    });

    it('should create a runtime with sendMessage method', async () => {
      const runtime = await messageRuntime.factory(validContext);

      expect(runtime).toBeDefined();
      expect(typeof runtime.sendMessage).toBe('function');
      expect(typeof runtime.readMessages).toBe('function');
      expect(typeof runtime.editMessage).toBe('function');
      expect(typeof runtime.deleteMessage).toBe('function');
    });
  });

  describe('Discord adapter', () => {
    it('should send a message via Discord', async () => {
      mockProviderFor('discord', { botToken: 'discord-token' });
      mockDiscordCreateMessage.mockResolvedValue({ id: 'msg-123' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'ch-1',
        content: 'Hello Discord!',
        platform: 'discord',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: 'ch-1',
        messageId: 'msg-123',
        platform: 'discord',
      });
    });

    it('should read messages from Discord', async () => {
      mockProviderFor('discord', { botToken: 'discord-token' });
      mockDiscordGetMessages.mockResolvedValue([
        {
          author: { id: 'u1', username: 'alice' },
          content: 'hello',
          id: 'msg-1',
          timestamp: '2024-01-01T00:00:00Z',
        },
      ]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.readMessages({
        channelId: 'ch-1',
        platform: 'discord',
      });

      expect(result.success).toBe(true);
      expect(result.state.messages).toHaveLength(1);
      expect(result.state.messages[0].author.name).toBe('alice');
    });
  });

  describe('Telegram adapter', () => {
    it('should send a message via Telegram', async () => {
      mockProviderFor('telegram', { botToken: 'tg-token' });
      mockTelegramSendMessage.mockResolvedValue({ message_id: 42 });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: '-100123',
        content: 'Hello Telegram!',
        platform: 'telegram',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: '-100123',
        messageId: '42',
        platform: 'telegram',
      });
    });

    it('should return error for unsupported readMessages', async () => {
      mockProviderFor('telegram', { botToken: 'tg-token' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.readMessages({
        channelId: '-100123',
        platform: 'telegram',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not supported on Telegram');
    });
  });

  describe('Slack adapter', () => {
    it('should send a message via Slack', async () => {
      mockProviderFor('slack', { botToken: 'slack-token' });
      mockSlackPostMessage.mockResolvedValue({ ts: '1234567890.123456' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'C0123456',
        content: 'Hello Slack!',
        platform: 'slack',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: 'C0123456',
        messageId: '1234567890.123456',
        platform: 'slack',
      });
    });
  });

  describe('Feishu adapter', () => {
    it('should send a message via Feishu', async () => {
      mockProviderFor('feishu', { appSecret: 'feishu-secret' });
      mockFeishuSendMessage.mockResolvedValue({ messageId: 'om_feishu_123', raw: {} });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'oc_chat_123',
        content: 'Hello Feishu!',
        platform: 'feishu',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: 'oc_chat_123',
        messageId: 'om_feishu_123',
        platform: 'feishu',
      });
    });
  });

  describe('QQ adapter', () => {
    it('should send a message via QQ', async () => {
      mockProviderFor('qq', { appSecret: 'qq-secret' });
      mockQQSendGroupMessage.mockResolvedValue({ id: 'qq-msg-1' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'group:123456',
        content: 'Hello QQ!',
        platform: 'qq',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: 'group:123456',
        messageId: 'qq-msg-1',
        platform: 'qq',
      });
    });

    it('should return error for unsupported editMessage', async () => {
      mockProviderFor('qq', { appSecret: 'qq-secret' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.editMessage({
        channelId: 'group:123',
        content: 'edit',
        messageId: 'msg-1',
        platform: 'qq',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not supported on QQ');
    });
  });

  describe('dispatcher error handling', () => {
    it('should return error for unconfigured platform', async () => {
      mockQuery.mockResolvedValue([]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'ch-1',
        content: 'test',
        platform: 'discord',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('No enabled discord bot provider found');
    });

    it('should return error for unregistered platform', async () => {
      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: 'ch-1',
        content: 'test',
        platform: 'irc' as any,
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('No message service configured for platform');
    });
  });
});
