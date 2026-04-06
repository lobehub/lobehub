import { describe, expect, it, vi } from 'vitest';

import type { DingTalkInboundMessagePayload } from './types';
import {
  buildDingTalkThreadId,
  buildDingTalkWebhookSignature,
  decryptDingTalkEventWithReceiver,
  encryptDingTalkEvent,
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

    it('strips leading @bot mention for common Chinese bot names', () => {
      const cnName = '机器人小助手';
      expect(stripLeadingBotMention(`@${cnName} 你好`, cnName)).toBe('你好');
    });

    it('does not strip when bot name is followed immediately by non-space characters', () => {
      const cnName = '机器人小助手';
      expect(stripLeadingBotMention(`@${cnName}你好`, cnName)).toBe(`@${cnName}你好`);
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

  describe('webhook crypto + callback handshake', () => {
    const TOKEN = 'token_123';
    const APPLICATION_ID = 'ding_appkey_456';
    const AES_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
      .toString('base64')
      .replace(/=+$/u, '');

    const createChatStub = () => {
      const logger = {
        child: () => logger,
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      };
      return {
        chat: {
          getLogger: () => logger,
          getState: () => ({}) as any,
          getUserName: () => BOT_NAME,
          processMessage: vi.fn(),
        } as any,
        logger,
      };
    };

    it('returns encrypted "success" payload for check_url verification events', async () => {
      const { createDingTalkAdapter } = await import('./adapter');
      const { chat } = createChatStub();

      const adapter = createDingTalkAdapter({
        aesKey: AES_KEY,
        applicationId: APPLICATION_ID,
        verificationToken: TOKEN,
      });
      await adapter.initialize(chat);

      const plaintext = JSON.stringify({ EventType: 'check_url' });
      const encrypt = encryptDingTalkEvent(plaintext, AES_KEY, APPLICATION_ID);

      const timestamp = '1783610513';
      const nonce = 'w2WPvWGOmIB';
      const signature = buildDingTalkWebhookSignature({ encrypt, nonce, timestamp, token: TOKEN });

      const req = new Request(
        `https://example.com/webhook?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
        {
          body: JSON.stringify({ encrypt }),
          method: 'POST',
        },
      );

      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual(
        expect.objectContaining({
          encrypt: expect.any(String),
          msg_signature: expect.any(String),
          nonce: expect.any(String),
          timeStamp: expect.any(String),
        }),
      );

      const decrypted = decryptDingTalkEventWithReceiver(body.encrypt, AES_KEY);
      expect(decrypted.receiverId).toBe(APPLICATION_ID);
      expect(decrypted.message).toBe('success');

      const expectedSig = buildDingTalkWebhookSignature({
        encrypt: body.encrypt,
        nonce: body.nonce,
        timestamp: body.timeStamp,
        token: TOKEN,
      });
      expect(body.msg_signature).toBe(expectedSig);
    });

    it('rejects invalid signatures before attempting to decrypt', async () => {
      const { createDingTalkAdapter } = await import('./adapter');
      const { chat, logger } = createChatStub();

      const adapter = createDingTalkAdapter({
        aesKey: AES_KEY,
        applicationId: APPLICATION_ID,
        verificationToken: TOKEN,
      });
      await adapter.initialize(chat);

      const encrypt = encryptDingTalkEvent(JSON.stringify({ EventType: 'check_url' }), AES_KEY, APPLICATION_ID);
      const req = new Request(
        'https://example.com/webhook?msg_signature=bad&timestamp=1&nonce=2',
        { body: JSON.stringify({ encrypt }), method: 'POST' },
      );

      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(401);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('rejects invalid decrypt payloads even when signature is valid', async () => {
      const { createDingTalkAdapter } = await import('./adapter');
      const { chat, logger } = createChatStub();

      const adapter = createDingTalkAdapter({
        aesKey: AES_KEY,
        applicationId: APPLICATION_ID,
        verificationToken: TOKEN,
      });
      await adapter.initialize(chat);

      const encrypt = Buffer.from('not a valid aes blob', 'utf8').toString('base64');
      const timestamp = '10';
      const nonce = '20';
      const signature = buildDingTalkWebhookSignature({ encrypt, nonce, timestamp, token: TOKEN });

      const req = new Request(
        `https://example.com/webhook?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
        { body: JSON.stringify({ encrypt }), method: 'POST' },
      );

      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(401);
      expect(logger.error).toHaveBeenCalled();
    });

    it('rejects encrypted callbacks when receiver/app key does not match applicationId', async () => {
      const { createDingTalkAdapter } = await import('./adapter');
      const { chat } = createChatStub();

      const adapter = createDingTalkAdapter({
        aesKey: AES_KEY,
        applicationId: APPLICATION_ID,
        verificationToken: TOKEN,
      });
      await adapter.initialize(chat);

      const encrypt = encryptDingTalkEvent(JSON.stringify({ EventType: 'check_url' }), AES_KEY, 'other-app-key');
      const timestamp = '1';
      const nonce = '2';
      const signature = buildDingTalkWebhookSignature({ encrypt, nonce, timestamp, token: TOKEN });

      const req = new Request(
        `https://example.com/webhook?msg_signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
        { body: JSON.stringify({ encrypt }), method: 'POST' },
      );

      const res = await adapter.handleWebhook(req);
      expect(res.status).toBe(401);
    });
  });
});
