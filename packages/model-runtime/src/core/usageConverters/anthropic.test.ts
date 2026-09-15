import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { convertAnthropicUsage } from './anthropic';

describe('convertAnthropicUsage', () => {
  it('should convert message_start usage with cache information', () => {
    const event = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        usage: {
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 10,
          input_tokens: 100,
          output_tokens: 5,
        },
      },
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(event);

    expect(usage).toEqual({
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 5,
      totalTokens: 135,
    });
  });

  it('should accumulate output tokens on message_delta', () => {
    const previousUsage = {
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 5,
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: {
        output_tokens: 8,
      },
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent, previousUsage);

    expect(usage).toEqual({
      inputCacheMissTokens: 100,
      inputCachedTokens: 10,
      inputWriteCacheTokens: 20,
      totalInputTokens: 130,
      totalOutputTokens: 13,
      totalTokens: 143,
    });
  });

  it('should keep previous usage when delta has no tokens', () => {
    const previousUsage = {
      totalInputTokens: 50,
      totalOutputTokens: 2,
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: null,
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent, previousUsage);

    expect(usage).toEqual({
      totalInputTokens: 50,
      totalOutputTokens: 2,
      totalTokens: 52,
    });
  });

  it('should return undefined when delta has no usage and no context', () => {
    const deltaEvent = {
      type: 'message_delta',
      delta: {
        stop_reason: 'end_turn',
      },
      usage: null,
    } as unknown as Anthropic.MessageStreamEvent;

    const usage = convertAnthropicUsage(deltaEvent);

    expect(usage).toBeUndefined();
  });
});

describe('convertAnthropicUsage cache-write TTL', () => {
  const deltaEvent = {
    type: 'message_delta',
    usage: { output_tokens: 5 },
  } as unknown as Anthropic.MessageStreamEvent;

  const streamUsage = {
    inputCacheMissTokens: 0,
    inputWriteCacheTokens: 1_000_000,
    totalInputTokens: 1_000_000,
    totalOutputTokens: 0,
  };

  // `pricingParams: ['ttl']` is what every current Anthropic card older than Opus 4.7 uses.
  const ttlPricing = {
    units: [
      {
        lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
        name: 'textInput_cacheWrite',
        strategy: 'lookup',
        unit: 'millionTokens',
      },
    ],
  } as any;

  it('prices a cache write instead of billing it as zero', () => {
    const usage = convertAnthropicUsage(deltaEvent, streamUsage, { pricing: ttlPricing } as any);

    // 1M tokens at $3.75/MTok — before the fix the lookup key was unresolved and cost was 0.
    expect(usage?.cost).toBeCloseTo(3.75, 6);
  });

  it('lets a caller-supplied ttl win over the default', () => {
    const usage = convertAnthropicUsage(deltaEvent, streamUsage, {
      pricing: ttlPricing,
      pricingOptions: { lookupParams: { ttl: '1h' } },
    } as any);

    expect(usage?.cost).toBeCloseTo(6, 6);
  });

  it('keeps other pricingOptions intact', () => {
    const usage = convertAnthropicUsage(deltaEvent, streamUsage, {
      pricing: {
        currency: 'CNY',
        units: [
          { name: 'textInput_cacheWrite', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        ],
      },
      pricingOptions: { usdToCnyRate: 10 },
    } as any);

    // 1M tokens at CNY 10/MTok converted at the supplied rate, not the built-in one.
    expect(usage?.cost).toBeCloseTo(1, 6);
  });
});
