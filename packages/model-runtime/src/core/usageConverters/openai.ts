import type { ModelTokensUsage, ModelUsage } from '@lobechat/types';
import debug from 'debug';
import type { Pricing } from 'model-bank';
import type OpenAI from 'openai';

import type { ChatPayloadForTransformStream } from '../streams/protocol';
import { withUsageCost } from './utils/withUsageCost';

const log = debug('lobe-cost:convertOpenAIUsage');

export const convertOpenAIUsage = (
  usage: OpenAI.Completions.CompletionUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage => {
  // Currently only pplx has citation_tokens
  const inputTextTokens = usage.prompt_tokens || 0;
  const inputCitationTokens = (usage as any).citation_tokens || 0;
  const totalInputTokens = inputCitationTokens + inputTextTokens;

  const cachedTokens =
    (usage as any).prompt_cache_hit_tokens || usage.prompt_tokens_details?.cached_tokens;

  const inputCacheMissTokens =
    (usage as any).prompt_cache_miss_tokens || totalInputTokens - cachedTokens;

  const totalOutputTokens = usage.completion_tokens;
  const outputReasoning = usage.completion_tokens_details?.reasoning_tokens || 0;
  const outputAudioTokens = usage.completion_tokens_details?.audio_tokens || 0;
  const outputImageTokens = (usage.completion_tokens_details as any)?.image_tokens || 0;

  // XAI's completion_tokens does not include reasoning_tokens, requires special handling
  const outputTextTokens =
    payload?.provider === 'xai'
      ? totalOutputTokens - outputAudioTokens
      : totalOutputTokens - outputReasoning - outputAudioTokens - outputImageTokens;
  const totalOutputTokensNormalized =
    payload?.provider === 'xai' ? totalOutputTokens + outputReasoning : totalOutputTokens;

  const totalTokens = inputCitationTokens + usage.total_tokens;

  const data = {
    acceptedPredictionTokens: usage.completion_tokens_details?.accepted_prediction_tokens,
    inputAudioTokens: usage.prompt_tokens_details?.audio_tokens,
    inputCacheMissTokens: inputCacheMissTokens,
    inputCachedTokens: cachedTokens,
    inputCitationTokens: inputCitationTokens,
    inputTextTokens: inputTextTokens,
    outputAudioTokens: outputAudioTokens,
    outputImageTokens: outputImageTokens,
    outputReasoningTokens: outputReasoning,
    outputTextTokens: outputTextTokens,
    rejectedPredictionTokens: usage.completion_tokens_details?.rejected_prediction_tokens,
    totalInputTokens,
    totalOutputTokens: totalOutputTokensNormalized,
    totalTokens,
  } satisfies ModelTokensUsage;

  const finalData = {};

  Object.entries(data).forEach(([key, value]) => {
    if (!!value) {
      // @ts-ignore
      finalData[key] = value;
    }
  });

  log('convertOpenAIUsage data(completion-api): %O', finalData);

  return withUsageCost(finalData as ModelUsage, payload?.pricing);
};

export const convertOpenAIResponseUsage = (
  usage: OpenAI.Responses.ResponseUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage => {
  // 1. Extract and default primary values
  const totalInputTokens = usage.input_tokens || 0;
  const inputCachedTokens = usage.input_tokens_details?.cached_tokens || 0;

  const totalOutputTokens = usage.output_tokens || 0;
  const outputReasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0;

  const overallTotalTokens = usage.total_tokens || 0;

  // 2. Calculate derived values
  const inputCacheMissTokens = totalInputTokens - inputCachedTokens;

  // For ResponseUsage, inputTextTokens is effectively totalInputTokens as no further breakdown is given.
  const inputTextTokens = totalInputTokens;

  // For ResponseUsage, outputTextTokens is totalOutputTokens minus reasoning, as no audio output tokens are specified.
  const outputTextTokens = totalOutputTokens - outputReasoningTokens;
  const outputImageTokens = (usage.output_tokens_details as any)?.image_tokens || 0;

  // 3. Construct the comprehensive data object (matching ModelTokensUsage structure)
  const data = {
    // Fields from ModelTokensUsage that are not in ResponseUsage will be undefined or 0
    // and potentially filtered out later.
    acceptedPredictionTokens: undefined, // Not in ResponseUsage
    inputAudioTokens: undefined, // Not in ResponseUsage
    inputCacheMissTokens: inputCacheMissTokens,
    inputCachedTokens: inputCachedTokens,
    inputCitationTokens: undefined, // Not in ResponseUsage
    inputTextTokens: inputTextTokens,
    outputAudioTokens: undefined, // Not in ResponseUsage
    outputImageTokens: outputImageTokens,
    outputReasoningTokens: outputReasoningTokens,
    outputTextTokens: outputTextTokens,
    rejectedPredictionTokens: undefined, // Not in ResponseUsage
    totalInputTokens: totalInputTokens,
    totalOutputTokens: totalOutputTokens,
    totalTokens: overallTotalTokens,
  } satisfies ModelTokensUsage; // This helps ensure all keys of ModelTokensUsage are considered

  // 4. Filter out zero/falsy values, as done in the reference implementation
  const finalData: Partial<ModelUsage> = {}; // Use Partial for type safety during construction
  Object.entries(data).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== 'number' || value !== 0) && // A more explicit check than `!!value` if we want to be very specific about
      // keeping non-numeric truthy values, but the reference uses `!!value`.
      // `!!value` will filter out 0, which is often desired for token counts.
      // Let's stick to the reference's behavior:
      !!value
    ) {
      // @ts-ignore - We are building an object that will conform to ModelTokensUsage
      // by selectively adding properties.
      finalData[key as keyof ModelUsage] = value as number;
    }
  });

  log('convertOpenAIResponseUsage data(response-api): %O', finalData);

  return withUsageCost(finalData as ModelUsage, payload?.pricing); // Cast because we've built it to match
};

export const convertOpenAIImageUsage = (
  usage: OpenAI.Images.ImagesResponse.Usage,
  pricing?: Pricing,
): ModelUsage => {
  const data: ModelTokensUsage = {
    inputImageTokens: usage.input_tokens_details.image_tokens,
    inputTextTokens: usage.input_tokens_details.text_tokens,
    outputImageTokens: usage.output_tokens,
    totalInputTokens: usage.input_tokens,
    totalOutputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };

  return withUsageCost(data as ModelUsage, pricing);
};
