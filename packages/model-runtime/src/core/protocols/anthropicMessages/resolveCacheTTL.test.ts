// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { ChatStreamPayload } from '../../../types/chat';
import { buildAnthropicMessages, buildAnthropicTools } from './messages';
import { buildDefaultAnthropicPayload, resolveDefaultAnthropicPricingOptions } from './payload';
import { buildCacheControl, resolveCacheTTL } from './resolveCacheTTL';

const tool = {
  function: { description: 'd', name: 'search', parameters: { properties: {}, type: 'object' } },
  type: 'function',
} as const;

const basePayload: ChatStreamPayload = {
  messages: [
    { content: 'system prompt', role: 'system' },
    { content: 'Hello', role: 'user' },
  ],
  enabledContextCaching: true,
  model: 'claude-sonnet-4-6',
  temperature: 0,
  tools: [tool],
};

const breakpoints = (payload: any) => [
  payload.tools?.at(-1)?.cache_control,
  payload.system?.[0]?.cache_control,
  payload.messages.at(-1).content.at(-1).cache_control,
];

describe('buildCacheControl', () => {
  it('omits ttl when none was resolved (the API default 5m)', () => {
    expect(buildCacheControl()).toEqual({ type: 'ephemeral' });
  });

  it('writes the resolved ttl, 5m included', () => {
    expect(buildCacheControl('5m')).toEqual({ ttl: '5m', type: 'ephemeral' });
    expect(buildCacheControl('1h')).toEqual({ ttl: '1h', type: 'ephemeral' });
  });
});

describe('context builders cache TTL', () => {
  it('marks the last message and last tool with the requested 1h ttl', async () => {
    const messages = await buildAnthropicMessages([{ content: 'Hi', role: 'user' }], {
      cacheTTL: '1h',
      enabledContextCaching: true,
    });
    expect((messages[0].content as any[])[0].cache_control).toEqual({
      ttl: '1h',
      type: 'ephemeral',
    });

    const tools = buildAnthropicTools([tool], { cacheTTL: '1h', enabledContextCaching: true });
    expect(tools?.[0].cache_control).toEqual({ ttl: '1h', type: 'ephemeral' });
  });

  it('keeps no breakpoints when caching is disabled, whatever the ttl', async () => {
    const messages = await buildAnthropicMessages([{ content: 'Hi', role: 'user' }], {
      cacheTTL: '1h',
      enabledContextCaching: false,
    });
    expect(messages[0].content).toBe('Hi');
    expect(buildAnthropicTools([tool], { cacheTTL: '1h' })?.[0].cache_control).toBeUndefined();
  });
});

describe('buildDefaultAnthropicPayload cache TTL', () => {
  it('keeps every breakpoint at the 5m default when no TTL is configured', async () => {
    const payload = await buildDefaultAnthropicPayload(basePayload, {
      allowExtendedCacheTTL: true,
    });

    expect(breakpoints(payload)).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
      { type: 'ephemeral' },
    ]);
    expect(resolveDefaultAnthropicPricingOptions(basePayload, payload)).toEqual({
      lookupParams: { ttl: '5m' },
    });
  });

  it('writes an explicit 5m on every breakpoint when the model config picks 5m', async () => {
    const request = { ...basePayload, contextCachingTTL: '5m' as const };
    const payload = await buildDefaultAnthropicPayload(request, { allowExtendedCacheTTL: true });

    expect(breakpoints(payload)).toEqual([
      { ttl: '5m', type: 'ephemeral' },
      { ttl: '5m', type: 'ephemeral' },
      { ttl: '5m', type: 'ephemeral' },
    ]);
    expect(resolveDefaultAnthropicPricingOptions(request, payload)).toEqual({
      lookupParams: { ttl: '5m' },
    });
  });

  it('writes 1h on every breakpoint and prices usage at the 1h rate when opted in', async () => {
    const request = { ...basePayload, contextCachingTTL: '1h' as const };
    const payload = await buildDefaultAnthropicPayload(request, { allowExtendedCacheTTL: true });

    expect(breakpoints(payload)).toEqual([
      { ttl: '1h', type: 'ephemeral' },
      { ttl: '1h', type: 'ephemeral' },
      { ttl: '1h', type: 'ephemeral' },
    ]);
    expect(resolveDefaultAnthropicPricingOptions(request, payload)).toEqual({
      lookupParams: { ttl: '1h' },
    });
  });

  it('ignores the 1h request for Anthropic-compatible endpoints that did not opt in', async () => {
    const request = { ...basePayload, contextCachingTTL: '1h' as const };
    const payload = await buildDefaultAnthropicPayload(request);

    expect(breakpoints(payload)).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
      { type: 'ephemeral' },
    ]);
    // Pricing follows what was actually written, not what was asked for.
    expect(resolveDefaultAnthropicPricingOptions(request, payload)).toEqual({
      lookupParams: { ttl: '5m' },
    });
  });
});

describe('resolveCacheTTL', () => {
  it('returns undefined when caching is off and no breakpoint carries a ttl', () => {
    expect(
      resolveCacheTTL(
        { ...basePayload, enabledContextCaching: false },
        { messages: [], system: [] },
      ),
    ).toBeUndefined();
  });
});
