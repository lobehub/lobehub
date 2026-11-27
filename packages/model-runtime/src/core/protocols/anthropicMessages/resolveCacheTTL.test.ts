import { describe, expect, it } from 'vitest';

import type { ChatStreamPayload } from '../../../types';
import { cacheTTLToSeconds, resolveCacheTTL } from './resolveCacheTTL';

const request = (overrides: Partial<ChatStreamPayload> = {}) =>
  ({ messages: [], model: 'claude', temperature: 1, ...overrides }) as ChatStreamPayload;

const cachedWithoutTTL = {
  messages: [
    {
      content: [
        { cache_control: { type: 'ephemeral' as const }, text: 'hi', type: 'text' as const },
      ],
      role: 'user' as const,
    },
  ],
  system: [
    { cache_control: { type: 'ephemeral' as const }, text: 'system', type: 'text' as const },
  ],
};

describe('resolveCacheTTL', () => {
  it("reports Anthropic's default lifetime for a cached request that never set enabledContextCaching", () => {
    const ttl = resolveCacheTTL(request(), cachedWithoutTTL, { anthropicCache: true });

    expect(ttl).toBe('5m');
  });

  it('does not assume Anthropic lifetimes for other Messages-compatible caches', () => {
    // DeepSeek, Moonshot and MiniMax accept these blocks but keep their caches far longer.
    expect(resolveCacheTTL(request(), cachedWithoutTTL)).toBeUndefined();
  });

  it('prefers an explicit lifetime on any block', () => {
    const ttl = resolveCacheTTL(request(), {
      messages: [
        {
          content: [{ cache_control: { ttl: '1h', type: 'ephemeral' }, text: 'hi', type: 'text' }],
          role: 'user',
        },
      ],
      system: [{ cache_control: { type: 'ephemeral' }, text: 'system', type: 'text' }],
    });

    expect(ttl).toBe('1h');
  });

  it('reports nothing for a request that asked for no caching', () => {
    const ttl = resolveCacheTTL(request({ enabledContextCaching: false }), {
      messages: [{ content: [{ text: 'hi', type: 'text' }], role: 'user' }],
      system: [{ text: 'system', type: 'text' }],
    });

    expect(ttl).toBeUndefined();
  });
});

describe('cacheTTLToSeconds', () => {
  it('converts the lifetimes Anthropic defines and nothing else', () => {
    expect(cacheTTLToSeconds('5m')).toBe(300);
    expect(cacheTTLToSeconds('1h')).toBe(3600);
    expect(cacheTTLToSeconds('2h')).toBeUndefined();
    expect(cacheTTLToSeconds(undefined)).toBeUndefined();
  });
});
