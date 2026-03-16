import { createDiscordAdapter } from '@chat-adapter/discord';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createLarkAdapter } from '@lobechat/adapter-lark';
import { describe, expect, it, vi } from 'vitest';

import { getPlatformDescriptor, platformDescriptors } from '../platforms';
import { discordDescriptor } from '../platforms/discord';
import { feishuDescriptor, larkDescriptor } from '../platforms/lark';
import { qqDescriptor } from '../platforms/qq';
import { telegramDescriptor } from '../platforms/telegram';

// Mock external dependencies before importing
vi.mock('@chat-adapter/discord', () => ({
  createDiscordAdapter: vi.fn().mockReturnValue({ type: 'discord-adapter' }),
}));

vi.mock('@chat-adapter/telegram', () => ({
  createTelegramAdapter: vi.fn().mockReturnValue({ type: 'telegram-adapter' }),
}));

vi.mock('@lobechat/adapter-lark', () => ({
  createLarkAdapter: vi.fn().mockReturnValue({ type: 'lark-adapter' }),
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.example.com' },
}));

vi.mock('../platforms/discord/restApi', () => ({
  DiscordRestApi: vi.fn().mockImplementation(() => ({
    createMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    editMessage: vi.fn().mockResolvedValue(undefined),
    removeOwnReaction: vi.fn().mockResolvedValue(undefined),
    triggerTyping: vi.fn().mockResolvedValue(undefined),
    updateChannelName: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../platforms/telegram/restApi', () => ({
  TelegramRestApi: vi.fn().mockImplementation(() => ({
    editMessageText: vi.fn().mockResolvedValue(undefined),
    removeMessageReaction: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
  })),
}));

vi.mock('../platforms/lark/restApi', () => ({
  LarkRestApi: vi.fn().mockImplementation(() => ({
    editMessage: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'lark-msg-1' }),
  })),
}));

vi.mock('@lobechat/adapter-qq', () => ({
  createQQAdapter: vi.fn().mockReturnValue({ type: 'qq-adapter' }),
}));

vi.mock('../platforms/qq/restApi', () => ({
  QQ_API_BASE: 'https://api.sgroup.qq.com',
  QQRestApi: vi.fn().mockImplementation(() => ({
    getAccessToken: vi.fn().mockResolvedValue('qq-token'),
    sendAsEdit: vi.fn().mockResolvedValue({ id: 'qq-msg-edit' }),
    sendMessage: vi.fn().mockResolvedValue({ id: 'qq-msg-1' }),
  })),
}));

describe('platformDescriptors registry', () => {
  it('should have all 5 platforms registered', () => {
    expect(Object.keys(platformDescriptors)).toEqual(
      expect.arrayContaining(['discord', 'telegram', 'lark', 'feishu', 'qq']),
    );
  });

  it('getPlatformDescriptor should return descriptor for known platforms', () => {
    expect(getPlatformDescriptor('discord')).toBe(discordDescriptor);
    expect(getPlatformDescriptor('telegram')).toBe(telegramDescriptor);
    expect(getPlatformDescriptor('lark')).toBe(larkDescriptor);
    expect(getPlatformDescriptor('feishu')).toBe(feishuDescriptor);
    expect(getPlatformDescriptor('qq')).toBe(qqDescriptor);
  });

  it('getPlatformDescriptor should return undefined for unknown platforms', () => {
    expect(getPlatformDescriptor('whatsapp')).toBeUndefined();
    expect(getPlatformDescriptor('')).toBeUndefined();
  });
});

describe('discordDescriptor', () => {
  it('should have correct platform properties', () => {
    expect(discordDescriptor.platform).toBe('discord');
    expect(discordDescriptor.persistent).toBe(true);
    expect(discordDescriptor.handleDirectMessages).toBe(false);
    expect(discordDescriptor.charLimit).toBeUndefined();
    expect(discordDescriptor.requiredCredentials).toEqual(['botToken']);
  });

  describe('extractChatId', () => {
    it('should extract channel ID from 3-part thread ID (no thread)', () => {
      expect(discordDescriptor.extractChatId('discord:guild:channel-123')).toBe('channel-123');
    });

    it('should extract thread ID from 4-part thread ID', () => {
      expect(discordDescriptor.extractChatId('discord:guild:parent:thread-456')).toBe('thread-456');
    });
  });

  describe('parseMessageId', () => {
    it('should return message ID as-is (string)', () => {
      expect(discordDescriptor.parseMessageId('msg-abc-123')).toBe('msg-abc-123');
    });
  });

  describe('createAdapter', () => {
    it('should create Discord adapter with correct params', () => {
      const credentials = { botToken: 'token-123', publicKey: 'key-abc' };
      const result = discordDescriptor.createAdapter(credentials, 'app-id');

      expect(result).toHaveProperty('discord');
      expect(createDiscordAdapter).toHaveBeenCalledWith({
        applicationId: 'app-id',
        botToken: 'token-123',
        publicKey: 'key-abc',
      });
    });
  });

  describe('createMessenger', () => {
    it('should create a messenger with all required methods', () => {
      const credentials = { botToken: 'token-123' };
      const messenger = discordDescriptor.createMessenger(
        credentials,
        'discord:guild:channel:thread',
      );

      expect(messenger).toHaveProperty('createMessage');
      expect(messenger).toHaveProperty('editMessage');
      expect(messenger).toHaveProperty('removeReaction');
      expect(messenger).toHaveProperty('triggerTyping');
      expect(messenger).toHaveProperty('updateThreadName');
    });
  });

  describe('onBotRegistered', () => {
    it('should call registerByToken with botToken', async () => {
      const registerByToken = vi.fn();
      await discordDescriptor.onBotRegistered?.({
        applicationId: 'app-1',
        credentials: { botToken: 'my-token' },
        registerByToken,
      });

      expect(registerByToken).toHaveBeenCalledWith('my-token');
    });

    it('should not call registerByToken when botToken is missing', async () => {
      const registerByToken = vi.fn();
      await discordDescriptor.onBotRegistered?.({
        applicationId: 'app-1',
        credentials: {},
        registerByToken,
      });

      expect(registerByToken).not.toHaveBeenCalled();
    });
  });
});

describe('telegramDescriptor', () => {
  it('should have correct platform properties', () => {
    expect(telegramDescriptor.platform).toBe('telegram');
    expect(telegramDescriptor.persistent).toBe(false);
    expect(telegramDescriptor.handleDirectMessages).toBe(true);
    expect(telegramDescriptor.charLimit).toBe(4000);
    expect(telegramDescriptor.requiredCredentials).toEqual(['botToken']);
  });

  describe('extractChatId', () => {
    it('should extract chat ID from platformThreadId', () => {
      expect(telegramDescriptor.extractChatId('telegram:chat-456')).toBe('chat-456');
    });

    it('should extract chat ID from multi-part ID', () => {
      expect(telegramDescriptor.extractChatId('telegram:chat-789:extra')).toBe('chat-789');
    });
  });

  describe('parseMessageId', () => {
    it('should parse numeric ID from composite string', () => {
      expect(telegramDescriptor.parseMessageId('telegram:chat-456:99')).toBe(99);
    });

    it('should parse plain numeric string', () => {
      expect(telegramDescriptor.parseMessageId('42')).toBe(42);
    });
  });

  describe('createAdapter', () => {
    it('should create Telegram adapter with correct params', () => {
      const credentials = { botToken: 'bot-token', secretToken: 'secret' };
      const result = telegramDescriptor.createAdapter(credentials, 'app-id');

      expect(result).toHaveProperty('telegram');
      expect(createTelegramAdapter).toHaveBeenCalledWith({
        botToken: 'bot-token',
        secretToken: 'secret',
      });
    });
  });

  describe('createMessenger', () => {
    it('should create a messenger with all required methods', () => {
      const credentials = { botToken: 'token-123' };
      const messenger = telegramDescriptor.createMessenger(credentials, 'telegram:chat-456');

      expect(messenger).toHaveProperty('createMessage');
      expect(messenger).toHaveProperty('editMessage');
      expect(messenger).toHaveProperty('removeReaction');
      expect(messenger).toHaveProperty('triggerTyping');
    });
  });
});

describe('larkDescriptor', () => {
  it('should have correct platform properties', () => {
    expect(larkDescriptor.platform).toBe('lark');
    expect(larkDescriptor.persistent).toBe(false);
    expect(larkDescriptor.handleDirectMessages).toBe(true);
    expect(larkDescriptor.charLimit).toBe(4000);
    expect(larkDescriptor.requiredCredentials).toEqual(['appId', 'appSecret']);
  });

  describe('extractChatId', () => {
    it('should extract chat ID from platformThreadId', () => {
      expect(larkDescriptor.extractChatId('lark:oc_abc123')).toBe('oc_abc123');
    });
  });

  describe('parseMessageId', () => {
    it('should return message ID as-is (string)', () => {
      expect(larkDescriptor.parseMessageId('om_abc123')).toBe('om_abc123');
    });
  });

  describe('createAdapter', () => {
    it('should create Lark adapter with correct params', () => {
      const credentials = {
        appId: 'cli_abc',
        appSecret: 'secret',
        encryptKey: 'enc-key',
        verificationToken: 'verify-token',
      };
      const result = larkDescriptor.createAdapter(credentials, 'app-id');

      expect(result).toHaveProperty('lark');
      expect(createLarkAdapter).toHaveBeenCalledWith({
        appId: 'cli_abc',
        appSecret: 'secret',
        encryptKey: 'enc-key',
        platform: 'lark',
        verificationToken: 'verify-token',
      });
    });
  });

  describe('createMessenger', () => {
    it('should create a messenger with no-op reaction and typing', async () => {
      const credentials = { appId: 'cli_abc', appSecret: 'secret' };
      const messenger = larkDescriptor.createMessenger(credentials, 'lark:oc_abc123');

      // Lark has no reaction/typing API
      await expect(messenger.removeReaction('msg-1', '👀')).resolves.toBeUndefined();
      await expect(messenger.triggerTyping()).resolves.toBeUndefined();
    });
  });

  it('should not define onBotRegistered', () => {
    expect(larkDescriptor.onBotRegistered).toBeUndefined();
  });
});

describe('feishuDescriptor', () => {
  it('should have correct platform properties', () => {
    expect(feishuDescriptor.platform).toBe('feishu');
    expect(feishuDescriptor.persistent).toBe(false);
    expect(feishuDescriptor.handleDirectMessages).toBe(true);
    expect(feishuDescriptor.charLimit).toBe(4000);
    expect(feishuDescriptor.requiredCredentials).toEqual(['appId', 'appSecret']);
  });

  describe('createAdapter', () => {
    it('should create adapter with feishu platform', () => {
      const credentials = { appId: 'cli_abc', appSecret: 'secret' };
      const result = feishuDescriptor.createAdapter(credentials, 'app-id');

      expect(result).toHaveProperty('feishu');
      expect(createLarkAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'feishu' }),
      );
    });
  });
});

describe('qqDescriptor', () => {
  it('should have correct platform properties', () => {
    expect(qqDescriptor.platform).toBe('qq');
    expect(qqDescriptor.persistent).toBe(false);
    expect(qqDescriptor.handleDirectMessages).toBe(true);
    expect(qqDescriptor.charLimit).toBe(2000);
    expect(qqDescriptor.requiredCredentials).toEqual(['appId', 'appSecret']);
  });

  describe('extractChatId', () => {
    it('should extract target ID from qq thread ID', () => {
      expect(qqDescriptor.extractChatId('qq:group:group-123')).toBe('group-123');
    });

    it('should extract target ID from c2c thread ID', () => {
      expect(qqDescriptor.extractChatId('qq:c2c:user-456')).toBe('user-456');
    });

    it('should extract target ID from guild thread ID', () => {
      expect(qqDescriptor.extractChatId('qq:guild:channel-789')).toBe('channel-789');
    });
  });

  describe('parseMessageId', () => {
    it('should return message ID as-is (string)', () => {
      expect(qqDescriptor.parseMessageId('msg-abc-123')).toBe('msg-abc-123');
    });
  });

  describe('createAdapter', () => {
    it('should create QQ adapter with correct params', () => {
      const credentials = { appId: 'app-123', appSecret: 'secret-456' };
      const result = qqDescriptor.createAdapter(credentials, 'app-id');

      expect(result).toHaveProperty('qq');
    });
  });

  describe('createMessenger', () => {
    it('should create a messenger with all required methods', () => {
      const credentials = { appId: 'app-123', appSecret: 'secret-456' };
      const messenger = qqDescriptor.createMessenger(credentials, 'qq:group:group-123');

      expect(messenger).toHaveProperty('createMessage');
      expect(messenger).toHaveProperty('editMessage');
      expect(messenger).toHaveProperty('removeReaction');
      expect(messenger).toHaveProperty('triggerTyping');
    });

    it('should have no-op reaction and typing', async () => {
      const credentials = { appId: 'app-123', appSecret: 'secret-456' };
      const messenger = qqDescriptor.createMessenger(credentials, 'qq:group:group-123');

      // QQ has no reaction/typing API
      await expect(messenger.removeReaction('msg-1', '👀')).resolves.toBeUndefined();
      await expect(messenger.triggerTyping()).resolves.toBeUndefined();
    });
  });

  it('should not define onBotRegistered', () => {
    expect(qqDescriptor.onBotRegistered).toBeUndefined();
  });
});
