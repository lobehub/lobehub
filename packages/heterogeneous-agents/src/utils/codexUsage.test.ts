import { describe, expect, it } from 'vitest';

import { toCodexUsageData, toTurnUsageFromCumulative } from './codexUsage';

describe('Codex usage helpers', () => {
  it('maps reasoning and text output token breakdowns', () => {
    expect(
      toCodexUsageData({
        cached_input_tokens: 40,
        input_tokens: 100,
        output_tokens: 30,
        reasoning_output_tokens: 12,
      }),
    ).toEqual({
      inputCachedTokens: 40,
      inputCacheMissTokens: 60,
      outputReasoningTokens: 12,
      outputTextTokens: 18,
      totalInputTokens: 100,
      totalOutputTokens: 30,
      totalTokens: 130,
    });
  });

  it('omits output breakdowns when reasoning usage is missing or invalid', () => {
    for (const reasoningOutputTokens of [undefined, -1, 31, Number.NaN]) {
      const usage = toCodexUsageData({
        input_tokens: 100,
        output_tokens: 30,
        reasoning_output_tokens: reasoningOutputTokens,
      });

      expect(usage).not.toHaveProperty('outputReasoningTokens');
      expect(usage).not.toHaveProperty('outputTextTokens');
    }
  });

  it('subtracts reliable cumulative output breakdowns', () => {
    expect(
      toTurnUsageFromCumulative(
        {
          inputCachedTokens: 9,
          inputCacheMissTokens: 16,
          outputReasoningTokens: 12,
          outputTextTokens: 18,
          totalInputTokens: 25,
          totalOutputTokens: 30,
          totalTokens: 55,
        },
        {
          inputCachedTokens: 4,
          inputCacheMissTokens: 6,
          outputReasoningTokens: 4,
          outputTextTokens: 6,
          totalInputTokens: 10,
          totalOutputTokens: 10,
          totalTokens: 20,
        },
      ),
    ).toEqual({
      inputCachedTokens: 5,
      inputCacheMissTokens: 10,
      outputReasoningTokens: 8,
      outputTextTokens: 12,
      totalInputTokens: 15,
      totalOutputTokens: 20,
      totalTokens: 35,
    });
  });

  it('omits cumulative output breakdowns when the previous snapshot has none', () => {
    const usage = toTurnUsageFromCumulative(
      {
        inputCacheMissTokens: 20,
        outputReasoningTokens: 8,
        outputTextTokens: 12,
        totalInputTokens: 20,
        totalOutputTokens: 20,
        totalTokens: 40,
      },
      {
        inputCacheMissTokens: 10,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
      },
    );

    expect(usage).toMatchObject({
      inputCacheMissTokens: 10,
      totalInputTokens: 10,
      totalOutputTokens: 15,
      totalTokens: 25,
    });
    expect(usage).not.toHaveProperty('outputReasoningTokens');
    expect(usage).not.toHaveProperty('outputTextTokens');
  });

  it('omits non-monotonic cumulative output breakdowns', () => {
    const usage = toTurnUsageFromCumulative(
      {
        inputCacheMissTokens: 20,
        outputReasoningTokens: 6,
        outputTextTokens: 14,
        totalInputTokens: 20,
        totalOutputTokens: 20,
        totalTokens: 40,
      },
      {
        inputCacheMissTokens: 10,
        outputReasoningTokens: 7,
        outputTextTokens: 3,
        totalInputTokens: 10,
        totalOutputTokens: 10,
        totalTokens: 20,
      },
    );

    expect(usage).toMatchObject({
      inputCacheMissTokens: 10,
      totalInputTokens: 10,
      totalOutputTokens: 10,
      totalTokens: 20,
    });
    expect(usage).not.toHaveProperty('outputReasoningTokens');
    expect(usage).not.toHaveProperty('outputTextTokens');
  });
});
