// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { LinqChatAdapter } from './adapter';
import { pickLinqPoolNumber } from './pool';

const makeAdapter = () => {
  const api = {
    sendText: vi.fn(async () => ({ chat_id: 'chat_1', message: { id: 'msg_out' } })),
    startTyping: vi.fn(async () => {}),
  };
  const chat = {
    getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    getUserName: () => 'messenger-bot',
    processMessage: vi.fn(),
  };
  const adapter = new LinqChatAdapter({ api: api as any });
  return { adapter, api, chat };
};

const delivery = (data: Record<string, unknown>, eventType = 'message.received') =>
  new Request('https://app.test/api/agent/messenger/webhooks/linq', {
    body: JSON.stringify({ data, event_type: eventType }),
    method: 'POST',
  });

const inbound = {
  chat: { id: 'chat_1', is_group: false },
  direction: 'inbound',
  id: 'msg_in',
  parts: [{ type: 'text', value: 'hello **there**' }],
  sender_handle: { handle: '+1 (555) 000-1111' },
  sent_at: '2026-10-05T00:00:00Z',
};

describe('LinqChatAdapter', () => {
  it('turns a message.received delivery into a message authored by the normalized sender', async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat as any);

    const res = await adapter.handleWebhook(delivery(inbound));
    expect(res.status).toBe(200);
    expect(chat.processMessage).toHaveBeenCalledTimes(1);

    const [, threadId, factory] = chat.processMessage.mock.calls[0];
    expect(threadId).toBe('linq:chat_1');
    const message = await factory();
    // Routing key is the sender, normalized to E.164 — not the pool number.
    expect(message.author.userId).toBe('+15550001111');
    expect(message.text).toBe('hello **there**');
    expect(message.threadId).toBe('linq:chat_1');
  });

  it.each([
    ['outbound echoes', { ...inbound, direction: 'outbound' }, 'message.received'],
    ['group chats', { ...inbound, chat: { id: 'chat_g', is_group: true } }, 'message.received'],
    ['other event types', inbound, 'message.delivered'],
    ['senders without a handle', { ...inbound, sender_handle: null }, 'message.received'],
  ])('ignores %s', async (_label, data, eventType) => {
    const { adapter, chat } = makeAdapter();
    await adapter.initialize(chat as any);

    const res = await adapter.handleWebhook(delivery(data, eventType));
    expect(res.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
  });

  it('posts plain text into the chat, degrading markdown', async () => {
    const { adapter, api, chat } = makeAdapter();
    await adapter.initialize(chat as any);

    const raw = await adapter.postMessage('linq:chat_1', { markdown: '**Done** — see `x`' });
    expect(api.sendText).toHaveBeenCalledWith('chat_1', expect.not.stringContaining('**'));
    expect(raw.id).toBe('msg_out');
  });

  it('keeps literal brackets and underscores instead of markdown-escaping them', async () => {
    const { adapter, api, chat } = makeAdapter();
    await adapter.initialize(chat as any);

    await adapter.postMessage('linq:chat_1', { markdown: '[note] see snake_case and a*b' });
    expect(api.sendText).toHaveBeenCalledWith('chat_1', '[note] see snake_case and a*b');
  });

  it('never re-sends on edit (iMessage bubbles cannot be edited)', async () => {
    const { adapter, api, chat } = makeAdapter();
    await adapter.initialize(chat as any);

    await adapter.editMessage('linq:chat_1', 'msg_out', 'progress…');
    expect(api.sendText).not.toHaveBeenCalled();
  });
});

describe('pickLinqPoolNumber', () => {
  const pool = ['+15550000001', '+15550000002', '+15550000003'];

  it('is stable per key and stays inside the pool', () => {
    const picked = pickLinqPoolNumber(pool, 'user_alice');
    expect(pool).toContain(picked);
    expect(pickLinqPoolNumber(pool, 'user_alice')).toBe(picked);
  });

  it('spreads different keys across the pool', () => {
    const used = new Set(
      Array.from({ length: 50 }, (_, i) => pickLinqPoolNumber(pool, `user_${i}`)),
    );
    expect(used.size).toBe(pool.length);
  });

  it('refuses an empty pool', () => {
    expect(() => pickLinqPoolNumber([], 'user_alice')).toThrow(/empty/);
  });
});
