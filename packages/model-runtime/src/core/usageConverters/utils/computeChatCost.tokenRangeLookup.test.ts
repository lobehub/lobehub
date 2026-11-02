import type { ModelTokensUsage } from '@lobechat/types';
import type { AIChatModelCard, LookupPricingUnit } from 'model-bank';
import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import qwenChatModels from 'model-bank/qwen';
import volcengineChatModels from 'model-bank/volcengine';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

const creditsOf = (result: ReturnType<typeof computeChatCost>, unitName: string) =>
  result?.breakdown.find((item) => item.unit.name === unitName);

const qwenPlusPricing = qwenChatModels.find((model) => model.id === 'qwen-plus')?.pricing;

describe('computeChatCost token-range lookups', () => {
  it('prices qwen-plus input and output from the request token counts', () => {
    const usage: ModelTokensUsage = {
      inputTextTokens: 1_000_000,
      outputTextTokens: 1_000_000,
      totalInputTokens: 1_000_000,
      totalOutputTokens: 1_000_000,
    };

    const result = computeChatCost(qwenPlusPricing, usage);

    expect(result?.issues).toEqual([]);
    // Above 256K input tokens, non-thinking: input $1.2/M, output $3.6/M.
    expect(creditsOf(result, 'textInput')).toMatchObject({
      credits: 1_200_000,
      lookupKey: '[0.256, infinity]',
    });
    expect(creditsOf(result, 'textOutput')).toMatchObject({
      credits: 3_600_000,
      lookupKey: '[0.256, infinity]_[false]',
    });
    expect(result?.totalCost).toBeCloseTo(4.8);
  });

  it('uses the lower range up to and including its upper bound', () => {
    const usage: ModelTokensUsage = {
      inputTextTokens: 256_000,
      outputTextTokens: 1000,
      totalInputTokens: 256_000,
      totalOutputTokens: 1000,
    };

    const result = computeChatCost(qwenPlusPricing, usage);

    expect(creditsOf(result, 'textInput')?.lookupKey).toBe('[0, 0.256]');
    expect(creditsOf(result, 'textOutput')?.lookupKey).toBe('[0, 0.256]_[false]');
  });

  it('selects the input range from total prompt tokens, including cache reads', () => {
    const usage: ModelTokensUsage = {
      inputCacheMissTokens: 100_000,
      inputCachedTokens: 200_000,
      outputTextTokens: 1000,
      totalInputTokens: 300_000,
      totalOutputTokens: 1000,
    };

    const result = computeChatCost(qwenPlusPricing, usage);

    expect(result?.issues).toEqual([]);
    expect(creditsOf(result, 'textInput')).toMatchObject({
      credits: 120_000,
      lookupKey: '[0.256, infinity]',
    });
    expect(creditsOf(result, 'textInput_cacheRead')?.lookupKey).toBe('[0.256, infinity]');
  });

  it('infers thinking mode from reasoning tokens when the caller does not pass it', () => {
    const usage: ModelTokensUsage = {
      outputReasoningTokens: 600_000,
      outputTextTokens: 400_000,
      totalInputTokens: 1000,
      totalOutputTokens: 1_000_000,
    };

    const result = computeChatCost(qwenPlusPricing, usage);

    expect(creditsOf(result, 'textOutput')).toMatchObject({
      credits: 4_000_000,
      lookupKey: '[0, 0.256]_[true]',
    });
  });

  it('honors an explicit thinkingMode lookup param over the inferred one', () => {
    const usage: ModelTokensUsage = {
      outputTextTokens: 1_000_000,
      totalInputTokens: 1000,
      totalOutputTokens: 1_000_000,
    };

    const result = computeChatCost(qwenPlusPricing, usage, {
      lookupParams: { thinkingMode: true },
    });

    expect(creditsOf(result, 'textOutput')?.lookupKey).toBe('[0, 0.256]_[true]');
  });

  it('resolves two-dimensional input/output ranges', () => {
    const pricing = volcengineChatModels.find((model) => model.id === 'glm-4-7')?.pricing;
    const shortReply: ModelTokensUsage = {
      outputTextTokens: 100,
      totalInputTokens: 10_000,
      totalOutputTokens: 100,
    };
    const longReply: ModelTokensUsage = {
      ...shortReply,
      outputTextTokens: 300,
      totalOutputTokens: 300,
    };

    expect(creditsOf(computeChatCost(pricing, shortReply), 'textInput')?.lookupKey).toBe(
      '[0, 0.032]_[0, 0.0002]',
    );
    expect(creditsOf(computeChatCost(pricing, longReply), 'textInput')?.lookupKey).toBe(
      '[0, 0.032]_[0.0002, infinity]',
    );
  });

  // Every chat lookup param other than the caller-supplied `ttl` must be resolvable from usage,
  // so a card using an unknown param name fails here instead of silently pricing at $0.
  it('prices every model-bank chat lookup unit keyed on usage', () => {
    const usage: ModelTokensUsage = {
      inputCacheMissTokens: 10_000,
      inputCachedTokens: 10_000,
      outputTextTokens: 1000,
      totalInputTokens: 20_000,
      totalOutputTokens: 1000,
    };

    const failures = (LOBE_DEFAULT_MODEL_LIST as AIChatModelCard[])
      .filter((model) => model.type === 'chat')
      .flatMap((model) => {
        const units = (model.pricing?.units ?? []).filter(
          (unit): unit is LookupPricingUnit =>
            unit.strategy === 'lookup' &&
            unit.lookup.pricingParams.some((param) => param !== 'ttl'),
        );
        if (units.length === 0) return [];

        const result = computeChatCost(model.pricing, usage);
        return (result?.issues ?? [])
          .filter((issue) => units.includes(issue.unit as LookupPricingUnit))
          .map((issue) => `${model.providerId}/${model.id} ${issue.unit.name}: ${issue.reason}`);
      });

    expect(failures).toEqual([]);
  });
});
