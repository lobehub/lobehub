import { ModelTokensUsage } from '@lobechat/types';
import { Pricing } from 'model-bank';
import anthropicChatModels from 'model-bank/anthropic';
import googleChatModels from 'model-bank/google';
import lobehubChatModels from 'model-bank/lobehub';
import openaiChatModels from 'model-bank/openai';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

describe('computeChatPricing', () => {
  describe('OpenAI', () => {
    it('handles simple request without cache for gpt-4.1', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 8,
        inputTextTokens: 8,
        outputTextTokens: 11,
        totalInputTokens: 8,
        totalOutputTokens: 11,
        totalTokens: 19,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(2); // Only input and output, no cache

      // Verify input tokens
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(8);
      expect(input?.credits).toBe(16); // 8 * 2 = 16

      // Verify output tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(11);
      expect(output?.credits).toBe(88); // 11 * 8 = 88

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(104); // 16 + 88 = 104
      expect(totalCost).toBeCloseTo(0.000104, 6); // 104 credits = $0.000104
    });

    it('handles request with cache read for gpt-4.1', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 145,
        inputCachedTokens: 1024,
        inputTextTokens: 1169,
        outputTextTokens: 59,
        totalInputTokens: 1169,
        totalOutputTokens: 59,
        totalTokens: 1228,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(3); // Input, output, and cache read

      // Verify cache miss tokens (regular input)
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(145);
      expect(input?.credits).toBe(290); // 145 * 2 = 290

      // Verify output tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(59);
      expect(output?.credits).toBe(472); // 59 * 8 = 472

      // Verify cached tokens (discounted rate)
      const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
      expect(cached?.quantity).toBe(1024);
      expect(cached?.credits).toBe(512); // 1024 * 0.5 = 512

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(1274); // 290 + 472 + 512 = 1274
      expect(totalCost).toBeCloseTo(0.001274, 6); // 1274 credits = $0.001274
    });

    it('handles reasoning tokens in output pricing for o3 model', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 58,
        inputTextTokens: 58,
        outputReasoningTokens: 384,
        outputTextTokens: 1243,
        totalInputTokens: 58,
        totalOutputTokens: 1627, // 1243 + 384
        totalTokens: 1685,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(2); // Input and output

      // Verify input tokens
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(58);
      expect(input?.credits).toBe(116); // 58 * 2 = 116

      // Verify output tokens include reasoning tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(1627); // 1243 + 384 (reasoning tokens included)
      expect(output?.credits).toBe(13_016); // 1627 * 8 = 13016

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(13_132); // 116 + 13016 = 13132
      expect(totalCost).toBeCloseTo(0.013132, 6); // 13132 credits = $0.013132
    });
  });

  describe('Google', () => {
    it('computes tiered pricing with reasoning tokens for large context conversation', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-pro',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCachedTokens: 253_891,
        inputCacheMissTokens: 4_275, // totalInputTokens - inputCachedTokens = 258_166 - 253_891
        inputTextTokens: 258_166,
        outputReasoningTokens: 1_601,
        outputTextTokens: 1_462,
        totalInputTokens: 258_166,
        totalOutputTokens: 3_063,
        totalTokens: 261_229,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(3); // Input, cache read, and output

      // Verify cached tokens (over 200k threshold, use higher tier rate)
      const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
      expect(cached?.quantity).toBe(253_891);
      expect(cached?.credits).toBe(158_682); // ceil(158681.875) = 158682
      expect(cached?.segments).toEqual([{ quantity: 253_891, rate: 0.625, credits: 158_681.875 }]);

      // Verify input cache miss tokens (calculated as totalInputTokens - inputCachedTokens = 4275)
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(4_275); // 258_166 - 253_891 = 4_275 (cache miss)
      expect(input?.credits).toBe(5_344); // ceil(5343.75) = 5344
      expect(input?.segments).toEqual([{ quantity: 4_275, rate: 1.25, credits: 5_343.75 }]);

      // Verify output tokens include reasoning tokens (under 200k threshold, use lower tier rate)
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(3_063); // 1462 + 1601 = 3063 (reasoning tokens included)
      expect(output?.credits).toBe(30_630); // 3063 * 10 = 30630
      expect(output?.segments).toEqual([{ quantity: 3_063, rate: 10, credits: 30_630 }]);

      // Verify corrected totals (no double counting of cached tokens)
      expect(totalCredits).toBe(194_656); // 158682 + 5344 + 30630 = 194656
      expect(totalCost).toBeCloseTo(0.194656, 6); // 194656 credits = $0.194656
    });

    it('supports multi-modal fixed units for Gemini 2.5 Flash Image Preview', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-flash-image-preview',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 10_000,
        outputTextTokens: 5_000,
        outputImageTokens: 400,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);
      expect(result?.totalCredits).toBe(27_500);
      expect(result?.totalCost).toBeCloseTo(0.0275, 10);

      const input = result?.breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.credits).toBe(3_000);

      const outputText = result?.breakdown.find((item) => item.unit.name === 'textOutput');
      expect(outputText?.credits).toBe(12_500);

      const imageOutput = result?.breakdown.find((item) => item.unit.name === 'imageOutput');
      expect(imageOutput?.credits).toBe(12_000);
    });

    it('handles multi-modal image generation for Nano Banana', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-flash-image-preview',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputImageTokens: 5160,
        inputTextTokens: 60,
        outputImageTokens: 1290,
        outputTextTokens: 0,
        totalInputTokens: 5220,
        totalOutputTokens: 1290,
        totalTokens: 6510,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);
      expect(result?.totalCredits).toBe(40_266);
      expect(result?.totalCost).toBeCloseTo(0.040266, 6);

      const { breakdown } = result!;
      expect(breakdown).toHaveLength(4); // Text input, image input, text output, image output

      const textInput = result?.breakdown.find((item) => item.unit.name === 'textInput');
      expect(textInput?.quantity).toBe(60);
      expect(textInput?.credits).toBe(18); // 60 * 0.3 = 18

      const imageInput = result?.breakdown.find((item) => item.unit.name === 'imageInput');
      expect(imageInput?.quantity).toBe(5160);
      expect(imageInput?.credits).toBe(1_548); // 5160 * 0.3 = 1548

      const textOutput = result?.breakdown.find((item) => item.unit.name === 'textOutput');
      expect(textOutput?.quantity).toBe(0);
      expect(textOutput?.credits).toBe(0); // 0 * 2.5 = 0

      const imageOutput = result?.breakdown.find((item) => item.unit.name === 'imageOutput');
      expect(imageOutput?.quantity).toBe(1290);
      expect(imageOutput?.credits).toBe(38_700); // 1290 * 30 = 38700
    });

    it('handles large context conversation with cache cross-tier pricing for Gemini 2.5 Pro', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-pro',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCachedTokens: 257_955,
        inputCacheMissTokens: 5_005,
        inputTextTokens: 262_960,
        outputTextTokens: 1_744,
        totalInputTokens: 262_960,
        totalOutputTokens: 1_744,
        totalTokens: 264_704,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(3); // Cache read, input, and output

      // Verify cached tokens (cross-tier: over 200k threshold, use higher tier rate)
      const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
      expect(cached?.quantity).toBe(257_955);

      expect(cached?.credits).toBe(161_222); // ceil(161221.875) = 161222
      expect(cached?.segments).toEqual([{ quantity: 257_955, rate: 0.625, credits: 161_221.875 }]);

      // Verify input cache miss tokens (under 200k tier, use lower rate)
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(5_005);
      expect(input?.credits).toBe(6_257); // ceil(6256.25) = 6257
      expect(input?.segments).toEqual([{ quantity: 5_005, rate: 1.25, credits: 6_256.25 }]);

      // Verify output tokens (under 200k threshold, use lower tier rate)
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(1_744);
      expect(output?.credits).toBe(17_440); // 1744 * 10 = 17440
      expect(output?.segments).toEqual([{ quantity: 1_744, rate: 10, credits: 17_440 }]);

      // Verify totals match actual billing log
      expect(totalCredits).toBe(184_919); // 161222 + 6257 + 17440 = 184919
      expect(totalCost).toBeCloseTo(0.184919, 6); // 184919 credits = $0.184919
    });
  });

  describe('Anthropic', () => {
    it('handles lookup pricing with TTL for Claude Opus 4.1', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-opus-4-1-20250805',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 1_000,
        inputCachedTokens: 200,
        inputWriteCacheTokens: 300,
        outputTextTokens: 500,
      };

      const result = computeChatCost(pricing, usage, { lookupParams: { ttl: '5m' } });
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);
      expect(result?.totalCredits).toBe(58_425);
      expect(result?.totalCost).toBeCloseTo(0.058425, 10);

      const cacheWrite = result?.breakdown.find(
        (item) => item.unit.name === 'textInput_cacheWrite',
      );
      expect(cacheWrite?.lookupKey).toBe('5m');
      expect(cacheWrite?.credits).toBe(5_625);
    });

    it('handles lookup pricing with missing key and adds issue', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-opus-4-1-20250805',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 1_000,
        inputWriteCacheTokens: 300,
        outputTextTokens: 500,
      };

      // Provide an invalid TTL value that doesn't exist in the lookup table
      const result = computeChatCost(pricing, usage, { lookupParams: { ttl: 'invalid' } });
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(1);
      expect(result?.issues[0].reason).toContain('Lookup price not found for key');
      expect(result?.issues[0].reason).toContain('invalid');

      const cacheWrite = result?.breakdown.find(
        (item) => item.unit.name === 'textInput_cacheWrite',
      );
      expect(cacheWrite?.lookupKey).toBe('invalid');
      expect(cacheWrite?.credits).toBe(0); // No credits when lookup fails
    });

    it('handles lookup pricing with missing lookup params and adds issue', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-opus-4-1-20250805',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 1_000,
        inputWriteCacheTokens: 300,
        outputTextTokens: 500,
      };

      // Don't provide lookup params at all
      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(1);
      expect(result?.issues[0].reason).toContain('Missing lookup params');
      expect(result?.issues[0].reason).toContain('ttl');

      const cacheWrite = result?.breakdown.find(
        (item) => item.unit.name === 'textInput_cacheWrite',
      );
      expect(cacheWrite?.credits).toBe(0); // No credits when lookup params missing
    });

    it('handles lookup pricing with undefined lookup params and adds issue', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-opus-4-1-20250805',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 1_000,
        inputWriteCacheTokens: 300,
        outputTextTokens: 500,
      };

      // Provide null value for TTL (simulating missing/invalid value)
      const result = computeChatCost(pricing, usage, { lookupParams: { ttl: null as any } });
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(1);
      expect(result?.issues[0].reason).toContain('Missing lookup params');
      expect(result?.issues[0].reason).toContain('ttl');

      const cacheWrite = result?.breakdown.find(
        (item) => item.unit.name === 'textInput_cacheWrite',
      );
      expect(cacheWrite?.credits).toBe(0); // No credits when lookup params undefined
    });

    it('handles simple request without thinking for Claude Sonnet 4', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-sonnet-4-20250514',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 8,
        totalInputTokens: 8,
        totalOutputTokens: 24,
        totalTokens: 32,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(2); // Only input and output

      // Verify input tokens
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(8);
      expect(input?.credits).toBe(24); // 8 * 3 = 24

      // Verify output tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(24);
      expect(output?.credits).toBe(360); // 24 * 15 = 360

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(384); // 24 + 360 = 384
      expect(totalCost).toBeCloseTo(0.000384, 6); // 384 credits = $0.000384
    });

    it('handles request with cache read and write for Claude Sonnet 4', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-sonnet-4-20250514',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 4,
        inputCachedTokens: 1183,
        inputWriteCacheTokens: 458,
        totalInputTokens: 1645,
        totalOutputTokens: 522,
        totalTokens: 2167,
      };

      const result = computeChatCost(pricing, usage, { lookupParams: { ttl: '5m' } });
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(4); // Input, output, cache read, cache write

      // Verify cache miss tokens (regular input)
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(4);
      expect(input?.credits).toBe(12); // 4 * 3 = 12

      // Verify output tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(522);
      expect(output?.credits).toBe(7_830); // 522 * 15 = 7830

      // Verify cached tokens (discounted rate)
      const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
      expect(cached?.quantity).toBe(1183);
      expect(cached?.credits).toBe(355); // 354.9 rounded = 355

      // Verify cache write tokens
      const cacheWrite = breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');
      expect(cacheWrite?.quantity).toBe(458);
      expect(cacheWrite?.lookupKey).toBe('5m');
      expect(cacheWrite?.credits).toBe(1_718); // 1717.5 rounded = 1718

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(9_915); // 12 + 7830 + 355 + 1718 = 9915
      expect(totalCost).toBeCloseTo(0.009915, 6); // 9915 credits = $0.009915
    });

    it('handles complex scenario with all cache types for Claude Sonnet 4 Latest', () => {
      const pricing = anthropicChatModels.find(
        (model: { id: string }) => model.id === 'claude-sonnet-4-20250514',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 10,
        inputCachedTokens: 3021,
        inputWriteCacheTokens: 1697,
        totalInputTokens: 4728,
        totalOutputTokens: 2841,
        totalTokens: 7569,
      };

      const result = computeChatCost(pricing, usage, { lookupParams: { ttl: '5m' } });
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const { breakdown, totalCost, totalCredits } = result!;
      expect(breakdown).toHaveLength(4); // Input, output, cache read, cache write

      // Verify cache miss tokens (regular input)
      const input = breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(10);
      expect(input?.credits).toBe(30); // 10 * 3 = 30

      // Verify output tokens
      const output = breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(2841);
      expect(output?.credits).toBe(42_615); // 2841 * 15 = 42615

      // Verify cached tokens (discounted rate)
      const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
      expect(cached?.quantity).toBe(3021);
      expect(cached?.credits).toBe(907); // ceil(906.3) = 907

      // Verify cache write tokens (fixed strategy in lobehub model)
      const cacheWrite = breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');
      expect(cacheWrite?.quantity).toBe(1697);
      expect(cacheWrite?.credits).toBe(6_364); // ceil(6363.75) = 6364

      // Verify totals match the actual billing log
      expect(totalCredits).toBe(49_916); // 30 + 42615 + 907 + 6364 = 49916
      expect(totalCost).toBeCloseTo(0.049916, 6); // 49916 credits = $0.049916
    });
  });

  describe('Edge Cases', () => {
    it('handles tiered pricing with quantity exceeding all tier limits (fallback to last tier)', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-pro',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCacheMissTokens: 500_000, // Exceeds 200k threshold
        outputTextTokens: 300_000, // Exceeds 200k threshold
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(0);

      const input = result?.breakdown.find((item) => item.unit.name === 'textInput');
      expect(input?.quantity).toBe(500_000);
      // Should use the highest tier rate (2.5 for input > 200k)
      expect(input?.credits).toBe(1_250_000); // 500_000 * 2.5
      expect(input?.segments).toEqual([{ quantity: 500_000, rate: 2.5, credits: 1_250_000 }]);

      const output = result?.breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(300_000);
      // Should use the highest tier rate (15 for output > 200k)
      expect(output?.credits).toBe(4_500_000); // 300_000 * 15
      expect(output?.segments).toEqual([{ quantity: 300_000, rate: 15, credits: 4_500_000 }]);
    });

    it('handles unsupported pricing strategy and adds issue', () => {
      const unsupportedPricing = {
        units: [
          {
            name: 'textInput',
            strategy: 'unsupported-strategy',
            unit: 'millionTokens',
            rate: 1,
          },
        ],
      };

      const usage: ModelTokensUsage = {
        inputTextTokens: 1000,
      };

      const result = computeChatCost(unsupportedPricing as any, usage);
      expect(result).toBeDefined();
      expect(result?.issues).toHaveLength(1);
      expect(result?.issues[0].reason).toBe('Unsupported pricing strategy');
      expect(result?.totalCredits).toBe(0);
      expect(result?.totalCost).toBe(0);
    });

    it('returns undefined when pricing is not provided', () => {
      const usage: ModelTokensUsage = {
        inputTextTokens: 1000,
        outputTextTokens: 500,
      };

      const result = computeChatCost(undefined, usage);
      expect(result).toBeUndefined();
    });

    it('handles zero quantity for tiered pricing', () => {
      const pricing = googleChatModels.find(
        (model: { id: string }) => model.id === 'gemini-2.5-pro',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputTextTokens: 0,
        outputTextTokens: 0,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.totalCredits).toBe(0);
      expect(result?.totalCost).toBe(0);
    });

    it('throws error when using unsupported unit for fixed strategy', () => {
      const invalidPricing = {
        units: [
          {
            name: 'textInput',
            strategy: 'fixed',
            unit: 'unsupportedUnit',
            rate: 1,
          },
        ],
      };

      const usage: ModelTokensUsage = {
        inputTextTokens: 1000,
      };

      expect(() => computeChatCost(invalidPricing as any, usage)).toThrow(
        'Unsupported chat pricing unit: unsupportedUnit',
      );
    });

    it('throws error when inputCacheMissTokens is missing but cache tokens are present', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputCachedTokens: 1024,
        totalInputTokens: 1169,
        outputTextTokens: 59,
      };

      expect(() => computeChatCost(pricing, usage)).toThrow(
        'Missing inputCacheMissTokens! You can set it by inputCacheMissTokens = totalInputTokens - inputCachedTokens',
      );
    });

    it('handles output with only reasoning tokens', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      const usage: ModelTokensUsage = {
        inputTextTokens: 100,
        outputReasoningTokens: 500,
      };

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();

      const output = result?.breakdown.find((item) => item.unit.name === 'textOutput');
      expect(output?.quantity).toBe(500); // Only reasoning tokens
      expect(output?.credits).toBe(4_000); // 500 * 8
    });

    it('handles empty usage with no tokens', () => {
      const pricing = openaiChatModels.find(
        (model: { id: string }) => model.id === 'gpt-4.1',
      )?.pricing;
      expect(pricing).toBeDefined();

      // Usage with no tokens at all
      const usage: ModelTokensUsage = {};

      const result = computeChatCost(pricing, usage);
      expect(result).toBeDefined();
      expect(result?.breakdown).toHaveLength(0); // No breakdown items when no tokens
      expect(result?.totalCredits).toBe(0);
      expect(result?.totalCost).toBe(0);
    });
  });

  describe('Currency Conversion', () => {
    describe('DeepSeek (CNY pricing)', () => {
      it('converts CNY to USD for deepseek-chat without cache', () => {
        // DeepSeek pricing in CNY
        const pricing = {
          currency: 'CNY',
          units: [
            { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          ],
        };

        const usage: ModelTokensUsage = {
          inputCacheMissTokens: 1000,
          inputTextTokens: 1000,
          outputTextTokens: 500,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalTokens: 1500,
        };

        // Use fixed exchange rate for testing
        const result = computeChatCost(pricing as any, usage, { usdToCnyRate: 5 });
        expect(result).toBeDefined();
        expect(result?.issues).toHaveLength(0);

        const { breakdown, totalCost, totalCredits } = result!;
        expect(breakdown).toHaveLength(2); // Input and output

        // Verify input tokens
        // 1000 tokens * 2 CNY/M = 2000 raw CNY-credits
        // 2000 / 5 = 400 USD-credits
        const input = breakdown.find((item) => item.unit.name === 'textInput');
        expect(input?.quantity).toBe(1000);
        expect(input?.credits).toBe(400); // USD credits

        // Verify output tokens
        // 500 tokens * 3 CNY/M = 1500 raw CNY-credits
        // 1500 / 5 = 300 USD-credits
        const output = breakdown.find((item) => item.unit.name === 'textOutput');
        expect(output?.quantity).toBe(500);
        expect(output?.credits).toBe(300); // USD credits

        // Verify totals with CNY to USD conversion
        // Total USD credits = 400 + 300 = 700
        // totalCredits = ceil(700) = 700
        expect(totalCredits).toBe(700);

        // totalCost = 700 / 1_000_000 = 0.0007 USD
        expect(totalCost).toBeCloseTo(0.0007, 6);
      });

      it('converts CNY to USD for deepseek-chat with cache tokens', () => {
        const pricing = {
          currency: 'CNY',
          units: [
            { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          ],
        } satisfies Pricing;

        const usage: ModelTokensUsage = {
          inputCacheMissTokens: 785,
          inputCachedTokens: 2752,
          inputTextTokens: 3537,
          outputTextTokens: 77,
          totalInputTokens: 3537,
          totalOutputTokens: 77,
          totalTokens: 3614,
        };

        const result = computeChatCost(pricing, usage, { usdToCnyRate: 5 });
        expect(result).toBeDefined();
        expect(result?.issues).toHaveLength(0);

        const { breakdown, totalCost, totalCredits } = result!;
        expect(breakdown).toHaveLength(3); // Cache read, input, and output

        // Verify cache miss tokens
        // 785 tokens * 2 CNY/M = 1570 raw CNY-credits
        // 1570 / 5 = 314 USD-credits
        const input = breakdown.find((item) => item.unit.name === 'textInput');
        expect(input?.quantity).toBe(785);
        expect(input?.credits).toBe(314); // USD credits

        // Verify cached tokens
        // 2752 tokens * 0.2 CNY/M = 550.4 raw CNY-credits
        // 550.4 / 5 = 110.08 -> ceil(110.08) = 111 USD-credits
        const cached = breakdown.find((item) => item.unit.name === 'textInput_cacheRead');
        expect(cached?.quantity).toBe(2752);
        expect(cached?.credits).toBe(111); // USD credits

        // Verify output tokens
        // 77 tokens * 3 CNY/M = 231 raw CNY-credits
        // 231 / 5 = 46.2 -> ceil(46.2) = 47 USD-credits
        const output = breakdown.find((item) => item.unit.name === 'textOutput');
        expect(output?.quantity).toBe(77);
        expect(output?.credits).toBe(47); // USD credits

        // Verify totals with CNY to USD conversion
        // Total USD credits = 314 + 111 + 47 = 472
        expect(totalCredits).toBe(472);

        // totalCost = 472 / 1_000_000 = 0.000472 USD
        expect(totalCost).toBe(0.000472);
      });

      it('converts CNY to USD for large token usage', () => {
        const pricing = {
          currency: 'CNY',
          units: [
            { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          ],
        };

        const usage: ModelTokensUsage = {
          inputTextTokens: 1_000_000, // 1M input tokens
          outputTextTokens: 500_000, // 500K output tokens
        };

        const result = computeChatCost(pricing as any, usage, { usdToCnyRate: 5 });
        expect(result).toBeDefined();

        const { totalCost, totalCredits } = result!;

        // Input: 1M * 2 CNY = 2M CNY-credits = 2M / 5 = 400000 USD-credits
        // Output: 500K * 3 CNY = 1.5M CNY-credits = 1.5M / 5 = 300000 USD-credits
        // Total: 700000 USD-credits
        expect(totalCredits).toBe(700_000);

        // totalCost = 700000 / 1_000_000 = 0.7 USD
        expect(totalCost).toBe(0.7);
      });
    });

    describe('USD pricing (no conversion)', () => {
      it('does not convert USD pricing', () => {
        const pricing = {
          currency: 'USD',
          units: [
            { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
          ],
        };

        const usage: ModelTokensUsage = {
          inputTextTokens: 1000,
          outputTextTokens: 500,
        };

        const result = computeChatCost(pricing as any, usage);
        expect(result).toBeDefined();

        const { totalCost, totalCredits } = result!;

        // Input: 1000 * 2 = 2000 USD-credits
        // Output: 500 * 8 = 4000 USD-credits
        // Total: 6000 USD-credits
        expect(totalCredits).toBe(6000);

        // totalCost = 6000 / 1_000_000 = 0.006 USD
        expect(totalCost).toBeCloseTo(0.006, 6);
      });

      it('defaults to USD when currency is not specified', () => {
        const pricing = {
          // No currency field
          units: [
            { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
          ],
        };

        const usage: ModelTokensUsage = {
          inputTextTokens: 1000,
          outputTextTokens: 500,
        };

        const result = computeChatCost(pricing as any, usage);
        expect(result).toBeDefined();

        const { totalCost, totalCredits } = result!;

        // Should be treated as USD (no conversion)
        expect(totalCredits).toBe(6000);
        expect(totalCost).toBeCloseTo(0.006, 6);
      });
    });
  });
});
