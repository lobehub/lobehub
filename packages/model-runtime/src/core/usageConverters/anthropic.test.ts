import type Anthropic from '@anthropic-ai/sdk';
import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { buildAnthropicInitialUsage, convertAnthropicUsage } from './anthropic';

describe('convertAnthropicUsage', () => {
  it('preserves an explicit zero cache read without inventing a missing value', () => {
    const usage = { input_tokens: 100, output_tokens: 10 } as Anthropic.Messages.Usage;
    expect(buildAnthropicInitialUsage(usage)?.inputCachedTokens).toBeUndefined();
    expect(
      buildAnthropicInitialUsage({ ...usage, cache_read_input_tokens: 0 })?.inputCachedTokens,
    ).toBe(0);
  });
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

  it('should forward pricingOptions so lookup-priced units can resolve', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 2, '5m': 1.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    const deltaEvent = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 0 },
    } as unknown as Anthropic.MessageStreamEvent;

    // 1M cache-write tokens at the 1h rate. Without the forwarded options the lookup
    // cannot resolve its key and the write unit contributes $0.
    const usage = convertAnthropicUsage(
      deltaEvent,
      {
        inputCacheMissTokens: 0,
        inputWriteCacheTokens: 1_000_000,
        totalInputTokens: 1_000_000,
        totalOutputTokens: 0,
      },
      { pricing, pricingOptions: { lookupParams: { ttl: '1h' } } },
    );

    expect(usage?.cost).toBeCloseTo(2, 10);
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
