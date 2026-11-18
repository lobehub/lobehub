import { describe, expect, it } from 'vitest';

import { BotWebhookInboundSchema, decodeWebhookThreadId, encodeWebhookThreadId } from './protocol';

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
