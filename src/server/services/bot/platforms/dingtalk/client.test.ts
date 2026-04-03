import { describe, expect, it, vi } from 'vitest';

import type { BotPlatformRuntimeContext, BotProviderConfig } from '../types';
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
  });

  it('passes validation when required values are present', async () => {
    const result = await factory.validateCredentials(baseCredentials, undefined, 'dingtalk-app');

    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
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
