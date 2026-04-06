import { describe, expect, it } from 'vitest';

import type { DingTalkInboundMessagePayload } from './types';
import {
  buildDingTalkThreadId,
  normalizeDingTalkInboundMessage,
  stripLeadingBotMention,
} from './helpers';

const BOT_NAME = 'lobehub-bot';

function buildPayload(
  overrides: Partial<DingTalkInboundMessagePayload>,
): DingTalkInboundMessagePayload {
  return {
    conversationId: 'cid_default',
    conversationType: '1',
    isInAtList: false,
    msgId: 'mid_default',
    msgtype: 'text',
    senderId: 'uid_default',
    senderNick: 'Alice',
    text: { content: 'hello' },
    ...overrides,
  };
}

describe('DingTalk helpers', () => {
  describe('buildDingTalkThreadId', () => {
    it('builds stable thread IDs for direct messages', () => {
      const payload = buildPayload({
        conversationType: '1',
        senderId: 'user_123',
      });

      expect(buildDingTalkThreadId(payload)).toBe('dingtalk:dm:user_123');
    });

    it('builds stable thread IDs for group messages', () => {
      const payload = buildPayload({
        conversationId: 'conv_456',
        conversationType: '2',
      });

      expect(buildDingTalkThreadId(payload)).toBe('dingtalk:group:conv_456');
    });
  });

  describe('stripLeadingBotMention', () => {
    it('strips leading @bot mention and whitespace', () => {
      expect(stripLeadingBotMention(`  @${BOT_NAME}   hello`, BOT_NAME)).toBe('hello');
    });

    it('does not strip @bot mention when it is not the leading token', () => {
      expect(stripLeadingBotMention(`hello @${BOT_NAME}`, BOT_NAME)).toBe(`hello @${BOT_NAME}`);
    });
  });

  describe('normalizeDingTalkInboundMessage', () => {
    it('requires bot mention in groups by default', () => {
      const payload = buildPayload({
        conversationType: '2',
        text: { content: 'hi bot' },
      });

      expect(normalizeDingTalkInboundMessage(payload, { botName: BOT_NAME })).toBeNull();
    });

    it('normalizes a text message payload into adapter shape (group mention)', () => {
      const payload = buildPayload({
        conversationId: 'conv_group',
        conversationType: '2',
        isInAtList: true,
        msgId: 'mid_1',
        senderId: 'user_1',
        text: { content: `@${BOT_NAME} ping` },
      });

      const normalized = normalizeDingTalkInboundMessage(payload, { botName: BOT_NAME });
      expect(normalized).not.toBeNull();
      expect(normalized).toEqual(
        expect.objectContaining({
          authorId: 'user_1',
          id: 'mid_1',
          isMention: true,
          text: 'ping',
          threadId: 'dingtalk:group:conv_group',
        }),
      );
    });

    it('returns null for unsupported message types', () => {
      const payload = buildPayload({
        msgtype: 'image',
        text: undefined,
      });

      expect(normalizeDingTalkInboundMessage(payload, { botName: BOT_NAME })).toBeNull();
    });
  });

  it('adapter scaffold compiles', async () => {
    const mod = await import('./adapter');
    expect(typeof mod.DingTalkAdapter).toBe('function');
    expect(typeof mod.createDingTalkAdapter).toBe('function');
  });
});
