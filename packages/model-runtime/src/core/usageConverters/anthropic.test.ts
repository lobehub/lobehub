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
