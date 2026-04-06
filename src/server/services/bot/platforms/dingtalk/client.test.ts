import { describe, expect, it, vi } from 'vitest';

import type { BotPlatformRuntimeContext, BotProviderConfig } from '../types';
import { DingTalkApi } from './api';
import { DINGTALK_NOT_IMPLEMENTED_MESSAGE, DingTalkClientFactory } from './client';

vi.mock('@/server/services/gateway/runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    failed: 'failed',
    starting: 'starting',
  },
  getRuntimeStatusErrorMessage: (error: Error) => error.message,
  updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
}));

const factory = new DingTalkClientFactory();
const baseContext = {} as BotPlatformRuntimeContext;
const baseCredentials = {
  clientSecret: 'secret',
  verificationToken: 'token',
  aesKey: 'aes',
};
const oauthUrl = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const oToMessagesUrl = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';
const groupMessagesUrl = 'https://api.dingtalk.com/v1.0/robot/groupMessages/send';

function buildConfig(settings: Record<string, unknown> = {}): BotProviderConfig {
  return {
    applicationId: 'dingtalk-app',
    platform: 'dingtalk',
    credentials: { ...baseCredentials },
    settings,
  };
}

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

    const result = await factory.validateCredentials(baseCredentials, undefined, 'dingtalk-app');

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      oauthUrl,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ appKey: 'dingtalk-app', appSecret: baseCredentials.clientSecret }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('returns a credentials error when OAuth authentication fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ message: 'invalid' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await factory.validateCredentials(baseCredentials, undefined, 'dingtalk-app');

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { field: 'credentials', message: 'Failed to authenticate with DingTalk API' },
    ]);
    vi.unstubAllGlobals();
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
      userIds: ['uid'],
      content: 'hello',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      oToMessagesUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'token' }),
      }),
    );
    vi.unstubAllGlobals();
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
    await api.sendTextMessage({ openConversationId: 'cid123', content: 'hello' });

    expect(fetchMock).toHaveBeenCalledWith(
      groupMessagesUrl,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-acs-dingtalk-access-token': 'token' }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('rejects missing or conflicting targets before making any network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const api = new DingTalkApi({ appKey: 'appKey', appSecret: 'secret' });

    await expect(api.sendTextMessage({ content: 'hello' })).rejects.toThrow(
      'sendTextMessage requires exactly one target',
    );
    await expect(
      api.sendTextMessage({ openConversationId: 'cid', userIds: ['uid'], content: 'hello' }),
    ).rejects.toThrow('sendTextMessage requires exactly one target');

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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
    await api.sendTextMessage({ userIds: ['uid'], content: 'hello' });
    await api.sendTextMessage({ userIds: ['uid'], content: 'hello again' });

    const oauthCalls = fetchMock.mock.calls.filter(([input]) => input === oauthUrl);
    expect(oauthCalls).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('DingTalkClient', () => {
  it('fails loudly on lifecycle operations and message helpers', async () => {
    const client = factory.createClient(buildConfig(), baseContext);

    await expect(client.start()).rejects.toThrow(DINGTALK_NOT_IMPLEMENTED_MESSAGE);
    expect(() => client.createAdapter()).toThrow(DINGTALK_NOT_IMPLEMENTED_MESSAGE);

    const messenger = client.getMessenger();
    await expect(messenger.createMessage('hi')).rejects.toThrow(DINGTALK_NOT_IMPLEMENTED_MESSAGE);
  });

  it('strips markdown when messageType is text and preserves markdown otherwise', () => {
    const textClient = factory.createClient(
      buildConfig({ messageType: 'text' }),
      baseContext,
    );
    const markdownClient = factory.createClient(
      buildConfig({ messageType: 'markdown' }),
      baseContext,
    );

    expect(textClient.formatMarkdown('**bold**')).toBe('bold');
    expect(markdownClient.formatMarkdown('**bold**')).toBe('**bold**');
  });

  it('appends usage stats when enabled and leaves replies untouched otherwise', () => {
    const stats = {
      totalTokens: 123,
      totalCost: 1,
      elapsedMs: 2000,
      llmCalls: 1,
      toolCalls: 2,
    };

    const statsClient = factory.createClient(
      buildConfig({ showUsageStats: true }),
      baseContext,
    );

    const replyWithStats = statsClient.formatReply('hello', stats);
    expect(replyWithStats).toContain('hello');
    expect(replyWithStats).toContain('tokens · $1.0000');
    expect(replyWithStats).toContain('llm×1');
    expect(replyWithStats).toContain('tools×2');

    const silentClient = factory.createClient(buildConfig({ showUsageStats: false }), baseContext);
    expect(silentClient.formatReply('hello', stats)).toBe('hello');
  });
});
