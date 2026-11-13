// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../types/chat';
import { LobeAnthropicAI } from './index';

const payload: ChatStreamPayload = {
  messages: [
    { content: 'system prompt', role: 'system' },
    { content: 'Hello', role: 'user' },
  ],
  model: 'claude-sonnet-4-6',
  temperature: 0,
};

const sentPayload = async (request: ChatStreamPayload) => {
  const instance = new LobeAnthropicAI({ apiKey: 'test' });
  const create = vi
    .spyOn(instance['client'].messages, 'create')
    .mockResolvedValue(new ReadableStream() as any);
  await instance.chat(request);
  return create.mock.calls[0][0] as any;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeAnthropicAI prompt cache TTL', () => {
  it('sends breakpoints without a ttl (API default 5m) when no TTL was resolved', async () => {
    const sent = await sentPayload(payload);

    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends explicit 5m breakpoints when contextCachingTTL is 5m', async () => {
    const sent = await sentPayload({ ...payload, contextCachingTTL: '5m' });

    expect(sent.system[0].cache_control).toEqual({ ttl: '5m', type: 'ephemeral' });
    expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({
      ttl: '5m',
      type: 'ephemeral',
    });
  });

  it('sends 1h breakpoints when contextCachingTTL is 1h', async () => {
    const sent = await sentPayload({ ...payload, contextCachingTTL: '1h' });

    expect(sent.system[0].cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });
    expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({
      ttl: '1h',
      type: 'ephemeral',
    });
  });
});
