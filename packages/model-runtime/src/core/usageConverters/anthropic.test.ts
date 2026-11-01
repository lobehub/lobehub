import type Anthropic from '@anthropic-ai/sdk';
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

  it('should treat message_delta output tokens as cumulative, not additive', () => {
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
      totalOutputTokens: 8,
      totalTokens: 138,
    });
  });

  /**
   * Replays the usage-bearing events of real streams, one per relay shape.
   */
  describe('relay event shapes', () => {
    const replay = (
      startUsage: Record<string, unknown>,
      deltaUsage: Record<string, unknown> | null,
    ) => {
      const start = convertAnthropicUsage({
        message: { id: 'msg', usage: startUsage },
        type: 'message_start',
      } as unknown as Anthropic.MessageStreamEvent);

      return convertAnthropicUsage(
        {
          delta: { stop_reason: 'end_turn' },
          type: 'message_delta',
          usage: deltaUsage,
        } as unknown as Anthropic.MessageStreamEvent,
        start,
      );
    };

    it('native Anthropic / Bedrock: input and cache on start, cumulative output on delta', () => {
      expect(
        replay(
          {
            cache_creation_input_tokens: 2048,
            cache_read_input_tokens: 4096,
            input_tokens: 25,
            output_tokens: 1,
          },
          { output_tokens: 312 },
        ),
      ).toEqual({
        inputCacheMissTokens: 25,
        inputCachedTokens: 4096,
        inputWriteCacheTokens: 2048,
        totalInputTokens: 6169,
        totalOutputTokens: 312,
        totalTokens: 6481,
      });
    });

    it('native Anthropic: a delta repeating the input and cache fields changes nothing else', () => {
      expect(
        replay(
          { cache_read_input_tokens: 4096, input_tokens: 25, output_tokens: 1 },
          {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 4096,
            input_tokens: 25,
            output_tokens: 312,
          },
        ),
      ).toEqual({
        inputCacheMissTokens: 25,
        inputCachedTokens: 4096,
        inputWriteCacheTokens: undefined,
        totalInputTokens: 4121,
        totalOutputTokens: 312,
        totalTokens: 4433,
      });
    });

    it('Vercel AI Gateway cache write: start is 0/0, full usage arrives on the delta', () => {
      expect(
        replay(
          { input_tokens: 0, output_tokens: 0 },
          { cache_creation_input_tokens: 58_802, input_tokens: 17, output_tokens: 6 },
        ),
      ).toEqual({
        inputCacheMissTokens: 17,
        inputCachedTokens: undefined,
        inputWriteCacheTokens: 58_802,
        totalInputTokens: 58_819,
        totalOutputTokens: 6,
        totalTokens: 58_825,
      });
    });

    it('Vercel AI Gateway cache hit: start is 0/0, full usage arrives on the delta', () => {
      expect(
        replay(
          { input_tokens: 0, output_tokens: 0 },
          { cache_read_input_tokens: 58_802, input_tokens: 17, output_tokens: 6 },
        ),
      ).toEqual({
        inputCacheMissTokens: 17,
        inputCachedTokens: 58_802,
        inputWriteCacheTokens: undefined,
        totalInputTokens: 58_819,
        totalOutputTokens: 6,
        totalTokens: 58_825,
      });
    });

    it('OpenRouter: start and delta repeat the same usage without doubling output', () => {
      const usage = { cache_creation_input_tokens: 8002, input_tokens: 17, output_tokens: 6 };

      expect(replay(usage, usage)).toEqual({
        inputCacheMissTokens: 17,
        inputCachedTokens: undefined,
        inputWriteCacheTokens: 8002,
        totalInputTokens: 8019,
        totalOutputTokens: 6,
        totalTokens: 8025,
      });
    });

    it('OpenRouter cache hit: start and delta repeat the same usage', () => {
      const usage = { cache_read_input_tokens: 8002, input_tokens: 17, output_tokens: 6 };

      expect(replay(usage, usage)).toMatchObject({
        inputCacheMissTokens: 17,
        inputCachedTokens: 8002,
        totalInputTokens: 8019,
        totalOutputTokens: 6,
      });
    });

    it('MiniMax: start is 0/0, input and cache read arrive on the delta', () => {
      // Captured from api.minimax.io/anthropic, model MiniMax-M3, 2026-11-01.
      expect(
        replay(
          { input_tokens: 0, output_tokens: 0, service_tier: 'standard' },
          {
            cache_read_input_tokens: 128,
            input_tokens: 3650,
            output_tokens: 5,
            service_tier: 'standard',
          },
        ),
      ).toEqual({
        inputCacheMissTokens: 3650,
        inputCachedTokens: 128,
        inputWriteCacheTokens: undefined,
        totalInputTokens: 3778,
        totalOutputTokens: 5,
        totalTokens: 3783,
      });
    });

    it('MiniMax: a start carrying only cache read is completed by the delta input', () => {
      // Production rows recorded input == cache read: the start held cache read with zero input.
      expect(
        replay(
          { cache_read_input_tokens: 18_203, input_tokens: 0, output_tokens: 0 },
          { cache_read_input_tokens: 18_203, input_tokens: 1, output_tokens: 36 },
        ),
      ).toMatchObject({
        inputCacheMissTokens: 1,
        inputCachedTokens: 18_203,
        totalInputTokens: 18_204,
        totalOutputTokens: 36,
      });
    });

    it('AiHubMix DeepSeek: the terminal delta input replaces the start estimate', () => {
      // Captured from aihubmix.com/v1/messages, model deepseek-v4-pro, 2026-11-01.
      expect(
        replay(
          {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 404,
            output_tokens: 0,
          },
          {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: 291,
            output_tokens: 64,
          },
        ),
      ).toMatchObject({
        inputCacheMissTokens: 291,
        totalInputTokens: 291,
        totalOutputTokens: 64,
        totalTokens: 355,
      });
    });

    it('keeps the start snapshot when a delta reports zero input and cache', () => {
      expect(
        replay(
          { cache_read_input_tokens: 4096, input_tokens: 25, output_tokens: 1 },
          { cache_read_input_tokens: 0, input_tokens: 0, output_tokens: 312 },
        ),
      ).toMatchObject({
        inputCacheMissTokens: 25,
        inputCachedTokens: 4096,
        totalInputTokens: 4121,
        totalOutputTokens: 312,
      });
    });

    it('keeps the start output when a delta reports zero output', () => {
      expect(
        replay({ input_tokens: 12, output_tokens: 6 }, { input_tokens: 12, output_tokens: 0 }),
      ).toMatchObject({
        totalInputTokens: 12,
        totalOutputTokens: 6,
        totalTokens: 18,
      });
    });

    it('keeps the start snapshot when the delta reports only a zero cache field', () => {
      expect(
        replay(
          { cache_read_input_tokens: 4096, input_tokens: 25, output_tokens: 1 },
          { cache_read_input_tokens: 0, output_tokens: 312 },
        ),
      ).toMatchObject({
        inputCacheMissTokens: 25,
        inputCachedTokens: 4096,
        totalInputTokens: 4121,
        totalOutputTokens: 312,
      });
    });

    it('lets a terminal zero input correct a start estimate when cache fields are reported', () => {
      expect(
        replay(
          { cache_read_input_tokens: 0, input_tokens: 404, output_tokens: 0 },
          { cache_read_input_tokens: 400, input_tokens: 0, output_tokens: 64 },
        ),
      ).toMatchObject({
        inputCacheMissTokens: 0,
        inputCachedTokens: 400,
        totalInputTokens: 400,
        totalOutputTokens: 64,
      });
    });

    it('prices the Vercel cache write from the delta usage', () => {
      const start = convertAnthropicUsage({
        message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } },
        type: 'message_start',
      } as unknown as Anthropic.MessageStreamEvent);
      const usage = convertAnthropicUsage(
        {
          delta: { stop_reason: 'end_turn' },
          type: 'message_delta',
          usage: { cache_creation_input_tokens: 58_802, input_tokens: 17, output_tokens: 6 },
        } as unknown as Anthropic.MessageStreamEvent,
        start,
        {
          pricing: {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
              {
                lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
                name: 'textInput_cacheWrite',
                strategy: 'lookup',
                unit: 'millionTokens',
              },
            ],
          },
        } as any,
      );

      // 17 * 3 + 58,802 * 3.75 + 6 * 15 per million tokens
      expect(usage?.cost).toBeCloseTo(0.220_648_5, 4);
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
