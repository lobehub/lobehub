// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatStreamPayload } from '../../types/chat';
import { isFirstPartyAnthropicBaseURL, LobeAnthropicAI } from './index';

const payload: ChatStreamPayload = {
  messages: [
    { content: 'system prompt', role: 'system' },
    { content: 'Hello', role: 'user' },
  ],
  model: 'claude-sonnet-4-6',
  temperature: 0,
};

const sentPayload = async (request: ChatStreamPayload, baseURL?: string) => {
  const instance = new LobeAnthropicAI({ apiKey: 'test', ...(baseURL && { baseURL }) });
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

  it('keeps the TTL when the base URL is Anthropic’s own API', async () => {
    const sent = await sentPayload(
      { ...payload, contextCachingTTL: '1h' },
      'https://api.anthropic.com/v1/messages',
    );

    expect(sent.system[0].cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });
    expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({
      ttl: '1h',
      type: 'ephemeral',
    });
  });

  it.each(['1h', '5m'] as const)(
    'leaves the %s TTL out when a custom base URL points at a proxy',
    async (contextCachingTTL) => {
      const tools = [
        {
          function: { description: 'Look up', name: 'lookup', parameters: { type: 'object' } },
          type: 'function' as const,
        },
      ];
      const sent = await sentPayload(
        { ...payload, contextCachingTTL, tools },
        'https://claude-proxy.example.com',
      );

      expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(sent.messages.at(-1).content.at(-1).cache_control).toEqual({ type: 'ephemeral' });
      expect(sent.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
      expect(JSON.stringify(sent)).not.toContain('"ttl"');
    },
  );
});

describe('isFirstPartyAnthropicBaseURL', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['https://api.anthropic.com', true],
    ['https://api.anthropic.com/v1', true],
    ['https://claude-proxy.example.com', false],
    ['https://api.anthropic.com.example.com', false],
    ['http://127.0.0.1:8080', false],
    ['not a url', false],
  ])('%s → %s', (baseURL, expected) => {
    expect(isFirstPartyAnthropicBaseURL(baseURL)).toBe(expected);
  });
});
