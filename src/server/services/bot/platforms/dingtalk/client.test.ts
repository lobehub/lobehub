import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_RUNTIME_STATUSES, updateBotRuntimeStatus } from '@/server/services/gateway/runtimeStatus';

import type { BotPlatformRuntimeContext, BotProviderConfig, PlatformClient } from '../types';
import { DingTalkApi } from './api';
import { DingTalkClientFactory } from './client';
import {
  buildDingTalkWebhookSignature,
  decryptDingTalkEventWithReceiver,
  encryptDingTalkEvent,
} from './helpers';

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (error: Error) => error.message,
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

const factory = new DingTalkClientFactory();
const baseContext = {} as BotPlatformRuntimeContext;
const baseApplicationId = 'dingtalk-app';
const baseCredentials = {
  aesKey: Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
    .toString('base64')
    .replace(/=+$/u, ''),
  clientSecret: 'secret',
  verificationToken: 'token_123',
};
const oauthUrl = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const oToMessagesUrl = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const groupMessagesUrl = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';

const updateRuntimeStatusMock = vi.mocked(updateBotRuntimeStatus);
type DingTalkClientUnderTest = PlatformClient & {
  formatMarkdown: NonNullable<PlatformClient['formatMarkdown']>;
  formatReply: NonNullable<PlatformClient['formatReply']>;
};

function buildConfig(settings: Record<string, unknown> = {}): BotProviderConfig {
  return {
    applicationId: baseApplicationId,
    platform: 'dingtalk',
    credentials: { ...baseCredentials },
    settings,
  };
}

function createClient(settings: Record<string, unknown> = {}): DingTalkClientUnderTest {
  return factory.createClient(buildConfig(settings), baseContext) as DingTalkClientUnderTest;
}

const createChatStub = () => {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  return {
    chat: {
      getLogger: () => logger,
      getUserName: () => 'lobehub-bot',
      processMessage: vi.fn(),
    } as any,
    logger,
  };
};

const createCheckUrlRequest = () => {
  const plaintext = JSON.stringify({ EventType: 'check_url' });
  const encrypt = encryptDingTalkEvent(plaintext, baseCredentials.aesKey, baseApplicationId);
  const timestamp = '1783610513';
  const nonce = 'w2WPvWGOmIB';
  const signature = buildDingTalkWebhookSignature({
    encrypt,
    nonce,
    timestamp,
    token: baseCredentials.verificationToken,
  });

  return {
    nonce,
    request: new Request(
      `https://example.com/webhook?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
      {
        body: JSON.stringify({ encrypt }),
        method: 'POST',
      },
    ),
    timestamp,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  updateRuntimeStatusMock.mockImplementation(async ({ applicationId, errorMessage, platform, status }) => ({
    applicationId,
    errorMessage,
    platform,
    status,
    updatedAt: 0,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DingTalkClientFactory', () => {
  it('requires applicationId and credentials before validating', async () => {
    const result = await factory.validateCredentials({}, undefined, undefined);

    expect(result.valid).toBe(false);
    const fields = result.errors?.map((error) => error.field).sort();
    expect(fields).toEqual(['aesKey', 'applicationId', 'clientSecret', 'verificationToken']);
    expect(result.errors?.find((error) => error.field === 'applicationId')?.message).toBe(
      'AppKey is required',
    );
  });

  it('authenticates against DingTalk OAuth when required values are present', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ accessToken: 'token', expireIn: 7200 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await factory.validateCredentials(baseCredentials, undefined, baseApplicationId);

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      oauthUrl,
      expect.objectContaining({
        body: JSON.stringify({ appKey: baseApplicationId, appSecret: baseCredentials.clientSecret }),
        method: 'POST',
      }),
    );
  });

  it('returns a credentials error when OAuth authentication fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ message: 'invalid' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await factory.validateCredentials(baseCredentials, undefined, baseApplicationId);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { field: 'credentials', message: 'Failed to authenticate with DingTalk API' },
    ]);
  });
});

describe('DingTalkApi', () => {
  it('sends direct text via robot API with x-acs-dingtalk-access-token header', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input === oauthUrl) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: 'token', expireIn: 7200 }),
        };
      }

      if (input === oToMessagesUrl) {
        return { ok: true, json: vi.fn().mockResolvedValue({ messageId: 'mid' }) };
      }

      throw new Error(`Unexpected fetch to ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });
    await api.sendTextMessage({
      content: 'hello',
      userIds: ['uid'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      oToMessagesUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'token' }),
        method: 'POST',
      }),
    );
  });

  it('selects group-send URL and payload when openConversationId is provided', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === oauthUrl) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: 'token', expireIn: 7200 }),
        };
      }

      if (input === groupMessagesUrl) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        expect(body.robotCode).toBe('appKey');
        expect(body.openConversationId).toBe('cid123');
        expect(body.userIds).toBeUndefined();
        return { ok: true, json: vi.fn().mockResolvedValue({ messageId: 'mid' }) };
      }

      throw new Error(`Unexpected fetch to ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });
    await api.sendTextMessage({ content: 'hello', openConversationId: 'cid123' });

    expect(fetchMock).toHaveBeenCalledWith(
      groupMessagesUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'token' }),
        method: 'POST',
      }),
    );
  });

  it('uses DingTalk markdown templates when markdown mode is requested', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      if (input === oauthUrl) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: 'token', expireIn: 7200 }),
        };
      }

      if (input === groupMessagesUrl) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        expect(body.msgKey).toBe('sampleMarkdown');
        expect(JSON.parse(body.msgParam)).toEqual({
          text: '# Title\n\nBody',
          title: 'Greeting',
        });
        return { ok: true, json: vi.fn().mockResolvedValue({ messageId: 'mid' }) };
      }

      throw new Error(`Unexpected fetch to ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });
    await api.sendTextMessage({
      content: '# Title\n\nBody',
      messageType: 'markdown',
      openConversationId: 'cid123',
      title: 'Greeting',
    });
  });

  it('rejects missing or conflicting targets before making any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });

    await expect(api.sendTextMessage({ content: 'hello' })).rejects.toThrow(
      'sendTextMessage requires exactly one target',
    );
    await expect(
      api.sendTextMessage({ content: 'hello', openConversationId: 'cid', userIds: ['uid'] }),
    ).rejects.toThrow('sendTextMessage requires exactly one target');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses cached access token for multiple sends', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input === oauthUrl) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ accessToken: 'token', expireIn: 7200 }),
        };
      }

      if (input === oToMessagesUrl) {
        return { ok: true, json: vi.fn().mockResolvedValue({ messageId: 'mid' }) };
      }

      throw new Error(`Unexpected fetch to ${input}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });
    await api.sendTextMessage({ content: 'hello', userIds: ['uid'] });
    await api.sendTextMessage({ content: 'hello again', userIds: ['uid'] });

    const oauthCalls = fetchMock.mock.calls.filter(([input]) => input === oauthUrl);
    expect(oauthCalls).toHaveLength(1);
  });
});

describe('DingTalkClient', () => {
  it('creates a DingTalk adapter with the encrypted callback credentials wired through', async () => {
    const client = createClient();

    const adapters = client.createAdapter();
    expect(adapters).toHaveProperty('dingtalk');

    const { chat } = createChatStub();
    await adapters.dingtalk.initialize(chat);

    const { nonce, request, timestamp } = createCheckUrlRequest();
    const res = await adapters.dingtalk.handleWebhook(request);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(
      expect.objectContaining({
        encrypt: expect.any(String),
        msg_signature: expect.any(String),
        nonce,
        timeStamp: timestamp,
      }),
    );

    const decrypted = decryptDingTalkEventWithReceiver(body.encrypt, baseCredentials.aesKey);
    expect(decrypted.receiverId).toBe(baseApplicationId);
    expect(decrypted.message).toBe('success');
  });

  it('marks runtime connected after a successful start', async () => {
    const getAccessTokenSpy = vi.spyOn(DingTalkApi.prototype, 'getAccessToken').mockResolvedValue(
      'token',
    );
    const client = createClient();

    await client.start();

    expect(getAccessTokenSpy).toHaveBeenCalledTimes(1);
    expect(updateRuntimeStatusMock).toHaveBeenNthCalledWith(1, {
      applicationId: baseApplicationId,
      platform: 'dingtalk',
      status: BOT_RUNTIME_STATUSES.starting,
    });
    expect(updateRuntimeStatusMock).toHaveBeenNthCalledWith(2, {
      applicationId: baseApplicationId,
      platform: 'dingtalk',
      status: BOT_RUNTIME_STATUSES.connected,
    });
  });

  it('marks runtime failed when start credential validation fails', async () => {
    vi.spyOn(DingTalkApi.prototype, 'getAccessToken').mockRejectedValue(new Error('bad auth'));
    const client = createClient();

    await expect(client.start()).rejects.toThrow('bad auth');

    expect(updateRuntimeStatusMock).toHaveBeenNthCalledWith(1, {
      applicationId: baseApplicationId,
      platform: 'dingtalk',
      status: BOT_RUNTIME_STATUSES.starting,
    });
    expect(updateRuntimeStatusMock).toHaveBeenNthCalledWith(2, {
      applicationId: baseApplicationId,
      errorMessage: 'bad auth',
      platform: 'dingtalk',
      status: BOT_RUNTIME_STATUSES.failed,
    });
  });

  it('marks runtime disconnected on stop', async () => {
    const client = createClient();

    await client.stop();

    expect(updateRuntimeStatusMock).toHaveBeenCalledWith({
      applicationId: baseApplicationId,
      platform: 'dingtalk',
      status: BOT_RUNTIME_STATUSES.disconnected,
    });
  });

  it('sends group replies through openConversationId', async () => {
    const sendTextMessageSpy = vi.spyOn(DingTalkApi.prototype, 'sendTextMessage').mockResolvedValue(
      {},
    );
    const client = createClient();

    await client.getMessenger('dingtalk:group:cid-group').createMessage('hello');

    expect(sendTextMessageSpy).toHaveBeenCalledWith({
      content: 'hello',
      messageType: 'markdown',
      openConversationId: 'cid-group',
      title: 'LobeHub',
    });
  });

  it('sends direct replies through userIds', async () => {
    const sendTextMessageSpy = vi.spyOn(DingTalkApi.prototype, 'sendTextMessage').mockResolvedValue(
      {},
    );
    const client = createClient();

    await client.getMessenger('dingtalk:dm:user-1').createMessage('hello');

    expect(sendTextMessageSpy).toHaveBeenCalledWith({
      content: 'hello',
      messageType: 'markdown',
      title: 'LobeHub',
      userIds: ['user-1'],
    });
  });

  it('falls back to plain text before sending when messageType is text', async () => {
    const sendTextMessageSpy = vi.spyOn(DingTalkApi.prototype, 'sendTextMessage').mockResolvedValue(
      {},
    );
    const client = createClient({ messageType: 'text' });

    expect(client.formatMarkdown('**hello** `world`')).toBe('hello world');

    await client.getMessenger('dingtalk:group:cid-group').createMessage('**hello** `world`');

    expect(sendTextMessageSpy).toHaveBeenCalledWith({
      content: 'hello world',
      messageType: 'text',
      openConversationId: 'cid-group',
      title: 'LobeHub',
    });
  });

  it('clamps invalid low charLimit values to the schema minimum before sending', async () => {
    const sendTextMessageSpy = vi.spyOn(DingTalkApi.prototype, 'sendTextMessage').mockResolvedValue(
      {},
    );
    const client = createClient({ charLimit: 5, messageType: 'text' });

    await client.getMessenger('dingtalk:group:cid-group').createMessage('a'.repeat(150));

    expect(sendTextMessageSpy).toHaveBeenCalledWith({
      content: 'a'.repeat(100),
      messageType: 'text',
      openConversationId: 'cid-group',
      title: 'LobeHub',
    });
  });

  it('rejects malformed platformThreadId values before routing outbound messages', () => {
    const client = createClient();

    expect(() => client.getMessenger('oops')).toThrow('Invalid DingTalk threadId: oops');
  });

  it('edits by sending a new message as fallback', async () => {
    const sendTextMessageSpy = vi.spyOn(DingTalkApi.prototype, 'sendTextMessage').mockResolvedValue(
      {},
    );
    const client = createClient();

    await client.getMessenger('dingtalk:group:cid-group').editMessage('mid-1', 'hello again');

    expect(sendTextMessageSpy).toHaveBeenCalledWith({
      content: 'hello again',
      messageType: 'markdown',
      openConversationId: 'cid-group',
      title: 'LobeHub',
    });
  });

  it('appends usage stats when enabled and leaves replies untouched otherwise', () => {
    const stats = {
      elapsedMs: 2000,
      llmCalls: 1,
      toolCalls: 2,
      totalCost: 1,
      totalTokens: 123,
    };

    const statsClient = createClient({ showUsageStats: true });

    const replyWithStats = statsClient.formatReply('hello', stats);
    expect(replyWithStats).toContain('hello');
    expect(replyWithStats).toContain('tokens · $1.0000');
    expect(replyWithStats).toContain('llm×1');
    expect(replyWithStats).toContain('tools×2');

    const silentClient = createClient({ showUsageStats: false });
    expect(silentClient.formatReply('hello', stats)).toBe('hello');
  });
});
