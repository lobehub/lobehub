import type { ChatTopicBotContext } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveDeviceAccessPolicy } from './deviceAccessPolicy';

const baseBotContext = (overrides: Partial<ChatTopicBotContext> = {}): ChatTopicBotContext => ({
  applicationId: 'app-123',
  isOwner: false,
  platform: 'discord',
  platformThreadId: 'discord:guild-1:channel-1',
  senderExternalUserId: 'discord-user-99',
  ...overrides,
});

describe('resolveDeviceAccessPolicy', () => {
  it('grants device access for first-party UI calls (no botContext)', () => {
    expect(resolveDeviceAccessPolicy({})).toEqual({
      canUseDevice: true,
      reason: 'first-party',
    });
  });

  it('grants device access when bot sender is the owner', () => {
    expect(
      resolveDeviceAccessPolicy({
        botContext: baseBotContext({ isOwner: true, senderExternalUserId: 'owner-id' }),
      }),
    ).toEqual({
      canUseDevice: true,
      reason: 'bot-owner',
    });
  });

  it('denies device access when bot sender is identified but not the owner', () => {
    expect(
      resolveDeviceAccessPolicy({
        botContext: baseBotContext({ isOwner: false, senderExternalUserId: 'random-user' }),
      }),
    ).toEqual({
      canUseDevice: false,
      reason: 'bot-external-sender',
    });
  });

  it('fails closed when bot context lacks a sender ID (settings.userId not configured)', () => {
    expect(
      resolveDeviceAccessPolicy({
        botContext: baseBotContext({ isOwner: false, senderExternalUserId: '' }),
      }),
    ).toEqual({
      canUseDevice: false,
      reason: 'bot-owner-not-configured',
    });
  });

  it('never returns canUseDevice=true for a non-owner bot sender, even with a trusted-looking ID', () => {
    // Future-proofing: until the trusted list lands, every non-owner bot
    // sender must be denied. This guards against accidentally reintroducing
    // a permissive default while wiring the future `bot-trusted` branch.
    const result = resolveDeviceAccessPolicy({
      botContext: baseBotContext({ isOwner: false, senderExternalUserId: 'team-mate' }),
    });
    expect(result.canUseDevice).toBe(false);
    expect(result.reason).not.toBe('bot-trusted');
  });

  describe('personal-scope bot platforms', () => {
    it('grants device access on WeChat even when isOwner cannot be computed', () => {
      // WeChat's schema has no `userId` field, so `isOwner` is structurally
      // false on every turn. Without the personal-scope branch, every WeChat
      // bot would be permanently denied.
      const result = resolveDeviceAccessPolicy({
        botContext: baseBotContext({
          isOwner: false,
          platform: 'wechat',
          senderExternalUserId: 'wechat-openid-xyz',
        }),
      });
      expect(result).toEqual({
        canUseDevice: true,
        reason: 'bot-personal-platform',
      });
    });

    it('still prefers `bot-owner` over `bot-personal-platform` when isOwner is true', () => {
      // If a future WeChat schema adds owner identification, the more
      // specific match wins.
      const result = resolveDeviceAccessPolicy({
        botContext: baseBotContext({
          isOwner: true,
          platform: 'wechat',
          senderExternalUserId: 'owner-openid',
        }),
      });
      expect(result.reason).toBe('bot-owner');
    });

    it('does NOT grant device access on group-capable platforms even if userId is unconfigured', () => {
      // Regression guard: don't accidentally widen the personal-scope set
      // to platforms that DO have group chat. Discord/Slack/Telegram etc.
      // must keep going through the standard isOwner gate.
      const platforms = ['discord', 'slack', 'telegram', 'feishu', 'lark', 'qq', 'line'];
      for (const platform of platforms) {
        const result = resolveDeviceAccessPolicy({
          botContext: baseBotContext({
            isOwner: false,
            platform,
            senderExternalUserId: 'random-user',
          }),
        });
        expect(result.canUseDevice).toBe(false);
        expect(result.reason).toBe('bot-external-sender');
      }
    });
  });
});
