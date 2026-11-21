import { describe, expect, it } from 'vitest';

import {
  BOT_ID_PATTERN,
  BotWebhookInboundSchema,
  decodeWebhookThreadId,
  encodeWebhookThreadId,
} from './protocol';

describe('webhook thread ids', () => {
  it('round-trips a group conversation with a sub-thread, colons included', () => {
    const thread = { conversationId: 'room:42', isDirect: false, threadId: 't:7' };
    const id = encodeWebhookThreadId(thread);

    expect(id).toBe('webhook:group:room%3A42:t%3A7');
    expect(decodeWebhookThreadId(id)).toEqual(thread);
  });

  it('round-trips a direct conversation without a thread', () => {
    const id = encodeWebhookThreadId({ conversationId: 'u-1', isDirect: true });

    expect(id).toBe('webhook:direct:u-1');
    expect(decodeWebhookThreadId(id)).toEqual({ conversationId: 'u-1', isDirect: true });
  });

  it('scopes the thread to the bot, so two bots on conversation 1 stay apart', () => {
    const conversation = { conversationId: '1', isDirect: false };
    const a = encodeWebhookThreadId({ ...conversation, botId: 'bot-a' });
    const b = encodeWebhookThreadId({ ...conversation, botId: 'bot-b' });

    expect(a).toBe('webhook:bot=bot-a:group:1');
    expect(a).not.toBe(b);
    expect(decodeWebhookThreadId(a)).toEqual({ ...conversation, botId: 'bot-a' });
    // The developer still gets their own conversation id back for callbacks.
    expect(decodeWebhookThreadId(a).conversationId).toBe('1');
    expect(decodeWebhookThreadId(b).conversationId).toBe('1');
  });

  it('never reads a bot id as the conversation kind, even when it is named "group"', () => {
    const id = encodeWebhookThreadId({ botId: 'group', conversationId: 'c', isDirect: false });

    expect(id).toBe('webhook:bot=group:group:c');
    expect(decodeWebhookThreadId(id)).toEqual({
      botId: 'group',
      conversationId: 'c',
      isDirect: false,
    });
  });

  it('still reads an unscoped id written before the bot was part of the identity', () => {
    expect(decodeWebhookThreadId('webhook:group:room%3A42:t%3A7')).toEqual({
      conversationId: 'room:42',
      isDirect: false,
      threadId: 't:7',
    });
  });

  it('reads a bare id (a REST channelId) as a group conversation of that name', () => {
    expect(decodeWebhookThreadId('room-42')).toEqual({
      conversationId: 'room-42',
      isDirect: false,
    });
  });
});

describe('BotWebhookInboundSchema', () => {
  it('fills defaults for a minimal message', () => {
    const parsed = BotWebhookInboundSchema.parse({
      message: { conversationId: 'c', id: 'm', user: { id: 'u' } },
      type: 'message',
    });

    expect(parsed).toEqual({
      message: {
        conversationId: 'c',
        id: 'm',
        isDirect: false,
        mentioned: false,
        text: '',
        user: { id: 'u' },
      },
      type: 'message',
    });
  });

  it('accepts a ping', () => {
    expect(BotWebhookInboundSchema.parse({ type: 'ping' })).toEqual({ type: 'ping' });
  });

  it.each([
    ['a missing user', { conversationId: 'c', id: 'm' }],
    [
      'an attachment without a URL',
      { attachments: [{ type: 'image' }], conversationId: 'c', id: 'm', user: { id: 'u' } },
    ],
    [
      'an unknown attachment type',
      {
        attachments: [{ type: 'sticker', url: 'https://x.test/a' }],
        conversationId: 'c',
        id: 'm',
        user: { id: 'u' },
      },
    ],
    [
      'eleven attachments',
      {
        attachments: Array.from({ length: 11 }, () => ({ type: 'file', url: 'https://x.test/a' })),
        conversationId: 'c',
        id: 'm',
        user: { id: 'u' },
      },
    ],
  ])('refuses %s', (_label, message) => {
    expect(BotWebhookInboundSchema.safeParse({ message, type: 'message' }).success).toBe(false);
  });
});

describe('BOT_ID_PATTERN', () => {
  const pattern = new RegExp(BOT_ID_PATTERN);

  it('accepts ordinary Bot IDs', () => {
    expect(['support-bot', 'abc', 'Team_Bot-01'].every((id) => pattern.test(id))).toBe(true);
  });

  it('refuses UUID-shaped ids, which the inbound route reads as REST bot ids', () => {
    expect(pattern.test('3763999e-6918-499f-aba1-5cb0ec7d6a56')).toBe(false);
    expect(pattern.test('3763999E-6918-499F-ABA1-5CB0EC7D6A56')).toBe(false);
  });

  it('refuses ids that are too short or carry other characters', () => {
    expect(['ab', '-bot', 'a b', 'bot:1'].some((id) => pattern.test(id))).toBe(false);
  });
});
