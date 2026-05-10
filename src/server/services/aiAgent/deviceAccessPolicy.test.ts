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
});
