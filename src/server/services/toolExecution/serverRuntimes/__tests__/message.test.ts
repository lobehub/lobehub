import { MessageToolIdentifier } from '@lobechat/builtin-tool-message';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

// ==================== Mocks ====================

const mockQuery = vi.fn();

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: vi.fn().mockImplementation(() => ({
    query: mockQuery,
  })),
}));

// ── System Bot model mocks ──────────────────────────────
// The `botProvider.*` System Bot methods (added in ) talk directly
// to these models instead of going through the messenger TRPC router, so
// the test must stub them at module boundary. Each mock returns a `vi.fn()`
// the individual test can `mockResolvedValueOnce` against.
const mockListByInstallerUserId = vi.fn();
const mockFindInstallationById = vi.fn();
const mockMarkRevoked = vi.fn();

vi.mock('@/database/models/messengerInstallation', () => ({
  MessengerInstallationModel: {
    findById: mockFindInstallationById,
    listByInstallerUserId: mockListByInstallerUserId,
    markRevoked: mockMarkRevoked,
  },
}));

const mockLinkList = vi.fn();
const mockLinkSetActiveAgent = vi.fn();
const mockLinkDeleteByPlatform = vi.fn();
const mockLinkFindByPlatform = vi.fn();

vi.mock('@/database/models/messengerAccountLink', () => ({
  MessengerAccountLinkModel: vi.fn().mockImplementation(() => ({
    deleteByPlatform: mockLinkDeleteByPlatform,
    findByPlatform: mockLinkFindByPlatform,
    list: mockLinkList,
    setActiveAgent: mockLinkSetActiveAgent,
  })),
}));

// Stub the agents schema as an opaque token — the runtime only uses it for
// `select.from(agents)` reference equality, so any object works.
vi.mock('@/database/schemas', () => ({
  agents: { id: 'agents.id', userId: 'agents.userId' },
}));

// `@/config/messenger` reads env-side messenger config — stub the four
// getters used by `listMessengerPlatforms`.
const mockGetEnabledMessengerPlatforms = vi.fn();
const mockGetMessengerSlackConfig = vi.fn();
const mockGetMessengerDiscordConfig = vi.fn();
const mockGetMessengerTelegramConfig = vi.fn();

vi.mock('@/config/messenger', () => ({
  getEnabledMessengerPlatforms: mockGetEnabledMessengerPlatforms,
  getMessengerDiscordConfig: mockGetMessengerDiscordConfig,
  getMessengerSlackConfig: mockGetMessengerSlackConfig,
  getMessengerTelegramConfig: mockGetMessengerTelegramConfig,
}));

const mockListSerializedPlatforms = vi.fn();

vi.mock('@/server/services/messenger', () => ({
  messengerPlatformRegistry: {
    listSerializedPlatforms: mockListSerializedPlatforms,
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn().mockResolvedValue({}),
  },
}));

// Stub the bot-settings helper so the test never loads its transitive
// imports (BotMessageRouter -> AiAgentService -> ModelRuntime). ModelRuntime
// reads server-only env at module construction, which the vitest client
// runtime rejects ("Attempted to access a server-side environment variable
// on the client"). The runtime under test doesn't exercise these helpers in
// any covered path; pass-through / no-op behaviour is enough to load.
vi.mock('@/server/services/bot/agentBotProviderSettings', () => ({
  assertBotAccessSettings: vi.fn(),
  invalidateBotAfterUpdate: vi.fn().mockResolvedValue(undefined),
  mergeBotSettingsForPersist: vi.fn((_platform, settings) => settings),
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
  SLACK_API_BASE: 'https://slack.com/api',
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

  describe('Telegram env-config fallback', () => {
    it('should fall back to env-backed config when no per-agent provider exists', async () => {
      mockQuery.mockResolvedValue([]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockTelegramSendMessage.mockResolvedValue({ message_id: 99 });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: '-100999',
        content: 'Hello via env config!',
        platform: 'telegram',
      });

      expect(result.success).toBe(true);
      expect(result.state).toMatchObject({
        channelId: '-100999',
        messageId: '99',
        platform: 'telegram',
      });
    });

    it('should fail with descriptive error when neither per-agent nor env config exists', async () => {
      mockQuery.mockResolvedValue([]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce(null);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.sendMessage({
        channelId: '-100999',
        content: 'Should fail',
        platform: 'telegram',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('No enabled telegram bot provider found');
      expect(result.content).toContain('no env-backed Telegram config');
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

  // ==================== System Bot management () ====================
  // Each test exercises both layers in one shot:
  //  1. `botProvider.<method>` in `src/server/services/toolExecution/serverRuntimes/message/index.ts`
  //  2. `MessageExecutionRuntime.<method>` formatting in
  //     `packages/builtin-tool-message/src/ExecutionRuntime/index.ts`
  // …because the factory returns a runtime where the botProvider impl is
  // already wired. Calling `runtime.listMessengers({})` hits both.
  //
  // System Bot mocks are module-level `vi.fn()`s — their call history
  // accumulates across tests, which trips `.not.toHaveBeenCalled()` checks
  // in negative paths. Reset before every System Bot case below.
  beforeEach(() => {
    for (const fn of [
      mockListByInstallerUserId,
      mockFindInstallationById,
      mockMarkRevoked,
      mockLinkList,
      mockLinkSetActiveAgent,
      mockLinkDeleteByPlatform,
      mockLinkFindByPlatform,
      mockGetEnabledMessengerPlatforms,
      mockGetMessengerSlackConfig,
      mockGetMessengerDiscordConfig,
      mockGetMessengerTelegramConfig,
      mockListSerializedPlatforms,
    ]) {
      fn.mockReset();
    }
  });

  describe('System Bot — listMessengers', () => {
    it('returns user-scoped non-revoked installs', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([
        {
          applicationId: 'app-slack',
          createdAt: new Date('2026-01-15T00:00:00Z'),
          id: 'inst_active',
          metadata: { tenantName: 'Acme' },
          platform: 'slack',
          revokedAt: null,
          tenantId: 'T1',
        },
        // Revoked rows are intentionally surfaced from the model — the
        // runtime filters them. Including one here proves the filter works.
        {
          applicationId: 'app-discord',
          createdAt: new Date('2026-01-10T00:00:00Z'),
          id: 'inst_revoked',
          metadata: {},
          platform: 'discord',
          revokedAt: new Date('2026-02-01T00:00:00Z'),
          tenantId: 'G1',
        },
      ]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.state.installations).toHaveLength(1);
      expect(result.state.installations[0].id).toBe('inst_active');
      expect(result.content).toContain('inst_active');
      expect(result.content).not.toContain('inst_revoked');
    });

    it('reports empty state with install guidance', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.content).toContain('No System Bot installations connected');
      expect(result.content).toContain('Settings → Messenger');
    });

    // Telegram is env-backed (no installation row); the runtime synthesizes a
    // virtual entry so the agent's two-step outbound discovery doesn't falsely
    // conclude Telegram is unconfigured while replying inside a Telegram chat.
    it('synthesizes a virtual telegram singleton when env+link both present', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockLinkFindByPlatform.mockResolvedValueOnce({
        createdAt: new Date('2026-03-01T00:00:00Z'),
        platform: 'telegram',
        tenantId: '',
        userId: 'user-1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.state.installations).toHaveLength(1);
      expect(result.state.installations[0]).toMatchObject({
        applicationId: 'telegram:singleton',
        id: 'telegram:singleton',
        installedAt: '2026-03-01T00:00:00.000Z',
        platform: 'telegram',
        tenantId: '',
        tenantName: 'Telegram',
      });
      expect(mockLinkFindByPlatform).toHaveBeenCalledWith('telegram');
    });

    it('omits the telegram singleton when env config is missing', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce(null);
      mockLinkFindByPlatform.mockResolvedValueOnce({
        createdAt: new Date('2026-03-01T00:00:00Z'),
        platform: 'telegram',
        tenantId: '',
        userId: 'user-1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.state.installations).toHaveLength(0);
    });

    it('omits the telegram singleton when the user has no telegram link', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockLinkFindByPlatform.mockResolvedValueOnce(undefined);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.state.installations).toHaveLength(0);
    });

    it('appends the telegram singleton alongside real installs', async () => {
      mockListByInstallerUserId.mockResolvedValueOnce([
        {
          applicationId: 'app-slack',
          createdAt: new Date('2026-01-15T00:00:00Z'),
          id: 'inst_slack',
          metadata: { tenantName: 'Acme' },
          platform: 'slack',
          revokedAt: null,
          tenantId: 'T1',
        },
      ]);
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockLinkFindByPlatform.mockResolvedValueOnce({
        createdAt: new Date('2026-03-01T00:00:00Z'),
        platform: 'telegram',
        tenantId: '',
        userId: 'user-1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengers({});

      expect(result.success).toBe(true);
      expect(result.state.installations.map((i: { id: string }) => i.id)).toEqual([
        'inst_slack',
        'telegram:singleton',
      ]);
    });
  });

  describe('System Bot — getMessengerDetail', () => {
    it('returns details for an install owned by the current user', async () => {
      mockFindInstallationById.mockResolvedValueOnce({
        applicationId: 'app-slack',
        createdAt: new Date('2026-01-15T00:00:00Z'),
        id: 'inst_match',
        installedByUserId: 'user-1',
        metadata: { scope: 'chat:write', tenantName: 'Acme' },
        platform: 'slack',
        revokedAt: null,
        tenantId: 'T1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.getMessengerDetail({ installationId: 'inst_match' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('inst_match');
      expect(result.content).toContain('Acme');
    });

    it('rejects detail lookup when the caller is not the installer', async () => {
      mockFindInstallationById.mockResolvedValueOnce({
        applicationId: 'app-slack',
        createdAt: new Date(),
        id: 'inst_other',
        installedByUserId: 'someone-else',
        metadata: {},
        platform: 'slack',
        revokedAt: null,
        tenantId: 'T1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.getMessengerDetail({ installationId: 'inst_other' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('only view installations you initiated');
    });

    it('returns not-found when the install does not exist', async () => {
      mockFindInstallationById.mockResolvedValueOnce(null);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.getMessengerDetail({ installationId: 'inst_missing' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
    });

    it('synthesizes detail for the telegram singleton id', async () => {
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockLinkFindByPlatform.mockResolvedValueOnce({
        createdAt: new Date('2026-03-01T00:00:00Z'),
        platform: 'telegram',
        tenantId: '',
        userId: 'user-1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.getMessengerDetail({ installationId: 'telegram:singleton' });

      expect(result.success).toBe(true);
      expect(result.content).toContain('telegram:singleton');
      expect(result.content).toContain('Telegram');
      // Never hits the installations table for the singleton id.
      expect(mockFindInstallationById).not.toHaveBeenCalled();
    });

    it('returns null for telegram singleton when user has no link', async () => {
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({
        botToken: 'tg-env-token',
        botUsername: 'lobehub_bot',
      });
      mockLinkFindByPlatform.mockResolvedValueOnce(undefined);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.getMessengerDetail({ installationId: 'telegram:singleton' });

      // Same null-shaped response shape as a missing real install.
      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
    });
  });

  describe('System Bot — uninstallMessenger', () => {
    it('marks the row revoked when caller is the installer', async () => {
      mockFindInstallationById.mockResolvedValueOnce({
        applicationId: 'app',
        createdAt: new Date(),
        id: 'inst_ok',
        installedByUserId: 'user-1',
        metadata: {},
        platform: 'slack',
        revokedAt: null,
        tenantId: 'T1',
      });
      mockMarkRevoked.mockResolvedValueOnce(undefined);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.uninstallMessenger({ installationId: 'inst_ok' });

      expect(result.success).toBe(true);
      expect(mockMarkRevoked).toHaveBeenCalledWith(expect.anything(), 'inst_ok');
    });

    it('rejects when caller is not the installer (FORBIDDEN)', async () => {
      mockFindInstallationById.mockResolvedValueOnce({
        applicationId: 'app',
        createdAt: new Date(),
        id: 'inst_blocked',
        installedByUserId: 'someone-else',
        metadata: {},
        platform: 'slack',
        revokedAt: null,
        tenantId: 'T1',
      });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.uninstallMessenger({ installationId: 'inst_blocked' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('only uninstall installations you initiated');
      expect(mockMarkRevoked).not.toHaveBeenCalled();
    });

    it('returns not-found when the install does not exist', async () => {
      mockFindInstallationById.mockResolvedValueOnce(null);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.uninstallMessenger({ installationId: 'inst_gone' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('not found');
    });

    it('rejects uninstall for the telegram singleton and steers caller to unlink', async () => {
      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.uninstallMessenger({ installationId: 'telegram:singleton' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Telegram is a global env-backed bot');
      expect(result.content).toContain('unlinkMessenger');
      // Must not have touched the installations table.
      expect(mockFindInstallationById).not.toHaveBeenCalled();
      expect(mockMarkRevoked).not.toHaveBeenCalled();
    });
  });

  describe('System Bot — listMessengerPlatforms', () => {
    it('returns enabled platforms with deep-link metadata', async () => {
      mockGetEnabledMessengerPlatforms.mockResolvedValueOnce(['slack', 'telegram']);
      mockListSerializedPlatforms.mockReturnValueOnce([
        { id: 'slack', name: 'Slack' },
        { id: 'telegram', name: 'Telegram' },
        { id: 'discord', name: 'Discord' },
      ]);
      mockGetMessengerSlackConfig.mockResolvedValueOnce({ appId: 'A123' });
      mockGetMessengerTelegramConfig.mockResolvedValueOnce({ botUsername: 'lobehub_bot' });

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengerPlatforms({});

      expect(result.success).toBe(true);
      // Discord is filtered out (not in enabled list)
      expect(result.state.platforms).toHaveLength(2);
      expect(result.content).toContain('slack');
      expect(result.content).toContain('A123');
      expect(result.content).toContain('lobehub_bot');
    });
  });

  describe('System Bot — listMessengerLinks', () => {
    it('returns the user’s account links', async () => {
      mockLinkList.mockResolvedValueOnce([
        {
          activeAgentId: 'agent_1',
          createdAt: new Date('2026-01-15T00:00:00Z'),
          platform: 'slack',
          platformUserId: 'U1',
          platformUsername: 'alice',
          tenantId: 'T1',
        },
      ]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengerLinks({});

      expect(result.success).toBe(true);
      expect(result.state.links).toHaveLength(1);
      expect(result.content).toContain('agent_1');
      expect(result.content).toContain('slack');
    });

    it('reports empty state when the user has no links', async () => {
      mockLinkList.mockResolvedValueOnce([]);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.listMessengerLinks({});

      expect(result.success).toBe(true);
      expect(result.content).toContain('No System Bot account links');
    });
  });

  describe('System Bot — setMessengerActiveAgent', () => {
    /**
     * Build a serverDB stub whose `select().from().where().limit()` chain
     * returns the agent rows the runtime expects when validating ownership.
     * Returning `[]` here simulates "agent doesn't belong to this user".
     */
    const ctxWithAgents = (agentLookupResult: Array<{ id: string }>): ToolExecutionContext => ({
      serverDB: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve(agentLookupResult),
            }),
          }),
        }),
      } as any,
      toolManifestMap: {},
      userId: 'user-1',
    });

    it('updates the link when the agent belongs to the user', async () => {
      mockLinkSetActiveAgent.mockResolvedValueOnce({ id: 'link-1', activeAgentId: 'agent_x' });

      const runtime = await messageRuntime.factory(ctxWithAgents([{ id: 'agent_x' }]));
      const result = await runtime.setMessengerActiveAgent({
        agentId: 'agent_x',
        platform: 'slack',
        tenantId: 'T1',
      });

      expect(result.success).toBe(true);
      expect(mockLinkSetActiveAgent).toHaveBeenCalledWith('slack', 'agent_x', 'T1');
    });

    it('rejects when the agent does not belong to the caller', async () => {
      const runtime = await messageRuntime.factory(ctxWithAgents([]));
      const result = await runtime.setMessengerActiveAgent({
        agentId: 'agent_foreign',
        platform: 'slack',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('Agent not found');
      expect(mockLinkSetActiveAgent).not.toHaveBeenCalled();
    });

    it('clears the active agent when agentId is null', async () => {
      mockLinkSetActiveAgent.mockResolvedValueOnce({ id: 'link-1', activeAgentId: null });

      // Null agentId path skips ownership check entirely.
      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.setMessengerActiveAgent({
        agentId: null,
        platform: 'telegram',
      });

      expect(result.success).toBe(true);
      expect(mockLinkSetActiveAgent).toHaveBeenCalledWith('telegram', null, undefined);
    });

    it('returns NOT_FOUND when the link does not exist', async () => {
      mockLinkSetActiveAgent.mockResolvedValueOnce(undefined);

      const runtime = await messageRuntime.factory(ctxWithAgents([{ id: 'agent_x' }]));
      const result = await runtime.setMessengerActiveAgent({
        agentId: 'agent_x',
        platform: 'discord',
      });

      expect(result.success).toBe(false);
      expect(result.content).toContain('No account link found');
    });
  });

  describe('System Bot — unlinkMessenger', () => {
    it('delegates to the link model', async () => {
      mockLinkDeleteByPlatform.mockResolvedValueOnce(undefined);

      const runtime = await messageRuntime.factory(validContext);
      const result = await runtime.unlinkMessenger({ platform: 'slack', tenantId: 'T1' });

      expect(result.success).toBe(true);
      expect(mockLinkDeleteByPlatform).toHaveBeenCalledWith('slack', 'T1');
    });
  });
});
