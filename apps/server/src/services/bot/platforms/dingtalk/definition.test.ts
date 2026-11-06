import { describe, expect, it } from 'vitest';

import { maskCredentials } from '../../credentialMasking';
import { getBotReplyLocale } from '../const';
import { platformRegistry } from '../index';
import { PLATFORM_UNSUPPORTED_MESSAGE_APIS } from '../messageCapabilities';
import { resolveConnectionMode } from '../utils';
import { DingTalkClientFactory } from './client';
import { dingtalk } from './definition';

describe('dingtalk platform definition', () => {
  it('is registered in the shared platform registry', () => {
    expect(platformRegistry.getPlatform('dingtalk')).toBe(dingtalk);
    expect(platformRegistry.listPlatforms().map((p) => p.id)).toContain('dingtalk');
  });

  it('serializes without the client factory for the channel UI', () => {
    const serialized = platformRegistry.listSerializedPlatforms().find((p) => p.id === 'dingtalk');
    expect(serialized).toBeDefined();
    expect(serialized).not.toHaveProperty('clientFactory');
    expect(serialized).toMatchObject({
      documentation: { setupGuideUrl: expect.stringContaining('/channels/dingtalk') },
      name: 'DingTalk',
    });
  });

  it('declares markdown replies, no message edits and its unsupported message APIs', () => {
    expect(dingtalk.supportsMarkdown).toBe(true);
    expect(dingtalk.supportsMessageEdit).toBe(false);
    expect(dingtalk.unsupportedMessageApis).toBe(PLATFORM_UNSUPPORTED_MESSAGE_APIS.dingtalk);
    expect(dingtalk.unsupportedMessageApis).toEqual(
      expect.arrayContaining(['reactToMessage', 'getReactions', 'readMessages', 'editMessage']),
    );
    expect(dingtalk.unsupportedMessageApis).not.toContain('sendMessage');
  });

  it('uses Stream mode unless the provider picked HTTP callbacks', () => {
    expect(dingtalk.connectionMode).toBe('websocket');
    expect(resolveConnectionMode(dingtalk, {})).toBe('websocket');
    expect(resolveConnectionMode(dingtalk, { connectionMode: 'webhook' })).toBe('webhook');
  });

  it('creates clients through the DingTalk factory', () => {
    expect(dingtalk.clientFactory).toBeInstanceOf(DingTalkClientFactory);
    const client = platformRegistry.createClient('dingtalk', {
      applicationId: 'dingapp',
      credentials: { clientSecret: 's' },
      platform: 'dingtalk',
      settings: {},
    });
    expect(client.id).toBe('dingtalk');
    expect(client.applicationId).toBe('dingapp');
  });

  it('replies to system strings in Chinese', () => {
    expect(getBotReplyLocale('dingtalk')).toBe('zh-CN');
  });

  it('masks the Client Secret but keeps RobotCode readable', () => {
    expect(
      maskCredentials('dingtalk', { clientSecret: 'real-secret', robotCode: 'dingrobot' }),
    ).toEqual({ clientSecret: expect.not.stringContaining('real-secret'), robotCode: 'dingrobot' });
    expect(maskCredentials('dingtalk', { clientSecret: '' })).toEqual({ clientSecret: '' });
  });
});
