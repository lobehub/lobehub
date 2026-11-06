import { type ModelUsage } from '@lobechat/types';
import { type LobeDefaultAiModelListItem } from 'model-bank';

import { getAudioInputUnitRate, getAudioOutputUnitRate } from '@/utils/pricing';

import { getPrice } from './pricing';

/** Pricing is USD per 1M tokens; returns the cost in dollars. */
const calcCost = (token: number, pricing?: number) => {
  if (!pricing) return '-';

  return (token * pricing) / 1_000_000;
};

export const getDetailsToken = (usage: ModelUsage, modelCard?: LobeDefaultAiModelListItem) => {
  const inputTextTokens = usage.inputTextTokens || (usage as any).inputTokens || 0;
  const totalInputTokens = usage.totalInputTokens || (usage as any).inputTokens || 0;

  const totalOutputTokens = usage.totalOutputTokens || (usage as any).outputTokens || 0;

  const outputReasoningTokens = usage.outputReasoningTokens || (usage as any).reasoningTokens || 0;

  const outputImageTokens = usage.outputImageTokens || (usage as any).imageTokens || 0;

  const inputToolTokens = usage.inputToolTokens || 0;

  const outputTextTokens =
    typeof usage.outputTextTokens === 'number'
      ? usage.outputTextTokens
      : Math.max(
          0,
          totalOutputTokens -
            outputReasoningTokens -
            (usage.outputAudioTokens || 0) -
            outputImageTokens,
        );

  const inputWriteCacheTokens = usage.inputWriteCacheTokens || 0;
  const inputCacheTokens = usage.inputCachedTokens || (usage as any).cachedTokens || 0;

  const inputCacheMissTokens =
    typeof usage?.inputCacheMissTokens === 'number'
      ? usage.inputCacheMissTokens
      : totalInputTokens - (inputCacheTokens || 0) - inputToolTokens;
  const cacheRateInputTokens = inputCacheMissTokens + inputCacheTokens + inputWriteCacheTokens;
  const cacheRate =
    cacheRateInputTokens > 0 && (inputCacheTokens > 0 || inputWriteCacheTokens > 0)
      ? inputCacheTokens / cacheRateInputTokens
      : undefined;

  // Pricing
  const formatPrice = getPrice(modelCard?.pricing || { units: [] });

  const inputCacheMissCost = (
    !!inputCacheMissTokens ? calcCost(inputCacheMissTokens, formatPrice.input) : 0
  ) as number;

  const inputCachedCost = (
    !!inputCacheTokens ? calcCost(inputCacheTokens, formatPrice.cachedInput) : 0
  ) as number;

  const inputWriteCachedCost = !!inputWriteCacheTokens
    ? (calcCost(inputWriteCacheTokens, formatPrice.writeCacheInput) as number)
    : 0;

  const totalOutputCost = (
    !!totalOutputTokens ? calcCost(totalOutputTokens, formatPrice.output) : 0
  ) as number;
  const totalInputCost = (
    !!totalInputTokens ? calcCost(totalInputTokens, formatPrice.input) : 0
  ) as number;
  const inputToolCost = (
    !!inputToolTokens ? calcCost(inputToolTokens, formatPrice.input) : 0
  ) as number;

  const totalCost =
    inputCacheMissCost + inputCachedCost + inputWriteCachedCost + inputToolCost + totalOutputCost;

  return {
    inputAudio: !!usage.inputAudioTokens
      ? {
          cost: calcCost(usage.inputAudioTokens, getAudioInputUnitRate(modelCard?.pricing)),
          token: usage.inputAudioTokens,
        }
      : undefined,
    inputCacheMiss: !!inputCacheMissTokens
      ? { cost: inputCacheMissCost, token: inputCacheMissTokens }
      : undefined,
    inputCached: !!inputCacheTokens
      ? { cost: inputCachedCost, token: inputCacheTokens }
      : undefined,
    inputCachedWrite: !!inputWriteCacheTokens
      ? { cost: inputWriteCachedCost, token: inputWriteCacheTokens }
      : undefined,
    inputCacheRate: cacheRate,
    inputCitation: !!usage.inputCitationTokens
      ? {
          cost: calcCost(usage.inputCitationTokens, formatPrice.input),
          token: usage.inputCitationTokens,
        }
      : undefined,
    inputText: !!inputTextTokens
      ? {
          cost: calcCost(inputTextTokens, formatPrice.input),
          token: inputTextTokens,
        }
      : undefined,
    inputTool: !!inputToolTokens
      ? {
          cost: inputToolCost,
          token: inputToolTokens,
        }
      : undefined,

    outputAudio: !!usage.outputAudioTokens
      ? {
          cost: calcCost(usage.outputAudioTokens, getAudioOutputUnitRate(modelCard?.pricing)),
          id: 'outputAudio',
          token: usage.outputAudioTokens,
        }
      : undefined,
    outputImage: !!outputImageTokens
      ? {
          cost: calcCost(outputImageTokens, formatPrice.output),
          id: 'outputImage',
          token: outputImageTokens,
        }
      : undefined,
    outputReasoning: !!outputReasoningTokens
      ? {
          cost: calcCost(outputReasoningTokens, formatPrice.output),
          token: outputReasoningTokens,
        }
      : undefined,
    outputText: !!outputTextTokens
      ? {
          cost: calcCost(outputTextTokens, formatPrice.output),
          token: outputTextTokens,
        }
      : undefined,

    totalInput: !!totalInputTokens ? { cost: totalInputCost, token: totalInputTokens } : undefined,
    totalOutput: !!totalOutputTokens
      ? { cost: totalOutputCost, token: totalOutputTokens }
      : undefined,
    totalTokens: !!usage.totalTokens ? { cost: totalCost, token: usage.totalTokens } : undefined,
  };
};
