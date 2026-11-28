import {
  type AudioTokenEstimateSource,
  type ChatRequestInputTokenEstimate,
  estimateChatRequestInputTokens,
  type EstimateChatRequestInputTokensOptions,
  normalizeAudioTokensPerSecond,
} from '@lobechat/token-estimator';
import type { ModelTokensUsage } from '@lobechat/types';
import type { Pricing, PricingUnitName } from 'model-bank';

import type { ChatCompletionTool, OpenAIChatMessage } from '../../../types/chat';
import type { ComputeChatCostOptions, PricingComputationResult } from './computeChatCost';
import { computeChatCost } from './computeChatCost';

const OUTPUT_INPUT_RATIO = 0.1;
const OUTPUT_TOKEN_CAP = 8192;

/**
 * Input-token estimate of an OpenAI-compatible chat request, from
 * `@lobechat/token-estimator`.
 */
export type ChatInputTokenEstimate = ChatRequestInputTokenEstimate;

export interface EstimateOpenAIChatInputTokensOptions extends Omit<
  EstimateChatRequestInputTokensOptions,
  'tools'
> {
  /**
   * Tool definitions are counted as input prompt tokens because providers receive them with the
   * chat request.
   */
  tools?: ChatCompletionTool[];
}

/**
 * Token buckets used to estimate chat costs before a provider returns real usage.
 *
 * Prefer `computeChatCost` with actual provider usage for final billing and reconciliation.
 */
export interface EstimateChatCostFromTokensInput {
  audioTokens?: number;
  imageTokens?: number;
  /**
   * Maximum output tokens from the request or model card. When omitted, the estimator uses the
   * default fallback cap.
   */
  maxOutputTokens?: number;
  /**
   * Optional expected output tokens. When omitted, the estimator uses a heuristic based on input
   * tokens.
   */
  outputTextTokens?: number;
  /**
   * Prompt-cache split of the text input. Omit it to price every input token at the plain input
   * price, as a request that does not use the cache would be.
   */
  promptCache?: EstimatePromptCacheInput;
  textTokens: number;
  videoTokens?: number;
}

/**
 * How a request is expected to use the provider prompt cache.
 *
 * `readTokens` of the text input are served from a warm cache at the cache-read price. The rest is
 * new to the provider: with `writesUncached` (explicit caching such as Anthropic `cache_control`)
 * it is written to the cache at the cache-write price, otherwise it bills as plain input. A cold
 * cache is `readTokens: 0`. Models without a cache-read or cache-write price fall back to the
 * plain input price for that part.
 */
export interface EstimatePromptCacheInput {
  readTokens: number;
  writesUncached: boolean;
}

/**
 * Cost estimate for budget pre-checks and UI hints. This is intentionally approximate and should
 * not be treated as the authoritative charged amount.
 */
export interface ChatCostEstimate extends PricingComputationResult {
  audioDurationItemCount?: number;
  audioFallbackItemCount?: number;
  audioTokenEstimateSource?: AudioTokenEstimateSource;
  estimatedCost: number;
  estimatedOutputTokens: number;
  inputAudioTokens: number;
  inputImageTokens: number;
  inputTextTokens: number;
  inputVideoTokens: number;
  totalInputTokens: number;
  usage: ModelTokensUsage;
}

export interface EstimateChatCostFromMessagesOptions
  extends ComputeChatCostOptions, EstimateOpenAIChatInputTokensOptions {
  /**
   * Maximum output tokens from the request or model card. When omitted, the estimator uses the
   * default fallback cap.
   */
  maxOutputTokens?: number;
}

const hasPricingUnit = (pricing: Pricing | undefined, unitName: PricingUnitName) =>
  pricing?.units.some((unit) => unit.name === unitName) ?? false;

/**
 * Splits billable text tokens into the cache-read, cache-write and plain-input buckets that
 * `computeChatCost` prices. A bucket the model has no price for folds into plain input, so a
 * model without cache pricing is never priced below what it bills.
 */
const splitPromptCacheTokens = (
  pricing: Pricing | undefined,
  billableTextTokens: number,
  { readTokens, writesUncached }: EstimatePromptCacheInput,
): Pick<
  ModelTokensUsage,
  'inputCacheMissTokens' | 'inputCachedTokens' | 'inputWriteCacheTokens'
> => {
  const cachedTokens = hasPricingUnit(pricing, 'textInput_cacheRead')
    ? Math.min(Math.max(0, readTokens), billableTextTokens)
    : 0;
  const uncachedTokens = billableTextTokens - cachedTokens;
  const writeTokens =
    writesUncached && hasPricingUnit(pricing, 'textInput_cacheWrite') ? uncachedTokens : 0;

  return {
    inputCacheMissTokens: uncachedTokens - writeTokens,
    inputCachedTokens: cachedTokens,
    inputWriteCacheTokens: writeTokens,
  };
};

/**
 * Estimates output tokens for budget pre-checks and UI hints.
 *
 * The default heuristic assumes output is one tenth of total input tokens. A request/model limit caps
 * the estimate when provided; otherwise 8192 tokens is used as a fallback cap.
 */
export function estimateChatOutputTokens(
  totalInputTokens: number,
  maxOutputTokens = OUTPUT_TOKEN_CAP,
): number {
  return Math.min(totalInputTokens * OUTPUT_INPUT_RATIO, maxOutputTokens);
}

/**
 * Estimates OpenAI-compatible chat input tokens without requiring provider-side usage.
 *
 * This helper is for pre-flight checks only. It counts text-like fields, tool definitions, and a
 * conservative per-media estimate; use provider usage plus `computeChatCost` for final billing.
 */
export function estimateOpenAIChatInputTokens(
  messages: OpenAIChatMessage[],
  options: EstimateOpenAIChatInputTokensOptions = {},
): ChatInputTokenEstimate {
  return estimateChatRequestInputTokens(messages, options);
}

/**
 * Estimates chat cost from known input token buckets.
 *
 * `outputTextTokens` defaults to `estimateChatOutputTokens(totalInputTokens, maxOutputTokens)`.
 * Pricing lookup options are forwarded to `computeChatCost`.
 */
export function estimateChatCostFromTokens(
  pricing: Pricing | undefined,
  input: EstimateChatCostFromTokensInput,
  options?: ComputeChatCostOptions,
): ChatCostEstimate | undefined {
  const inputAudioTokens = input.audioTokens ?? 0;
  const inputImageTokens = input.imageTokens ?? 0;
  const inputTextTokens = input.textTokens;
  const inputVideoTokens = input.videoTokens ?? 0;
  const totalInputTokens = inputTextTokens + inputImageTokens + inputAudioTokens + inputVideoTokens;
  const estimatedOutputTokens =
    input.outputTextTokens ?? estimateChatOutputTokens(totalInputTokens, input.maxOutputTokens);
  const hasAudioInputUnit = hasPricingUnit(pricing, 'audioInput');
  const hasImageInputUnit = hasPricingUnit(pricing, 'imageInput');
  const hasVideoInputUnit = hasPricingUnit(pricing, 'videoInput');
  // Some model cards price multimodal inputs through text input unless a dedicated unit exists.
  const billableTextTokens =
    inputTextTokens +
    (hasAudioInputUnit ? 0 : inputAudioTokens) +
    (hasImageInputUnit ? 0 : inputImageTokens) +
    (hasVideoInputUnit ? 0 : inputVideoTokens);

  const usage: ModelTokensUsage = {
    inputAudioTokens: hasAudioInputUnit ? inputAudioTokens : undefined,
    inputImageTokens: hasImageInputUnit ? inputImageTokens : undefined,
    inputTextTokens: billableTextTokens,
    inputVideoTokens: hasVideoInputUnit ? inputVideoTokens : undefined,
    outputTextTokens: estimatedOutputTokens,
    totalInputTokens,
    totalOutputTokens: estimatedOutputTokens,
    totalTokens: totalInputTokens + estimatedOutputTokens,
  };

  if (input.promptCache)
    Object.assign(usage, splitPromptCacheTokens(pricing, billableTextTokens, input.promptCache));

  const result = computeChatCost(pricing, usage, options);
  if (!result) return;

  return {
    ...result,
    estimatedCost: result.totalCost,
    estimatedOutputTokens,
    inputAudioTokens,
    inputImageTokens,
    inputTextTokens,
    inputVideoTokens,
    totalInputTokens,
    usage,
  };
}

/**
 * Estimates chat cost directly from OpenAI-compatible messages and optional tool definitions.
 *
 * This is intended for budget pre-checks and UI hints before the model call. Final charged cost
 * should still be computed from actual provider usage with `computeChatCost`.
 */
export function estimateChatCostFromMessages(
  pricing: Pricing | undefined,
  messages: OpenAIChatMessage[],
  options: EstimateChatCostFromMessagesOptions = {},
): ChatCostEstimate | undefined {
  const {
    audioTokenEstimate,
    audioTokensPerSecond,
    tools,
    imageTokenEstimate,
    lookupParams,
    maxOutputTokens,
    usdToCnyRate,
    videoTokenEstimate,
  } = options;
  const effectiveAudioTokensPerSecond =
    normalizeAudioTokensPerSecond(audioTokensPerSecond) ??
    normalizeAudioTokensPerSecond(pricing?.audioTokensPerSecond);
  const inputTokens = estimateOpenAIChatInputTokens(messages, {
    audioTokenEstimate,
    audioTokensPerSecond: effectiveAudioTokensPerSecond,
    imageTokenEstimate,
    tools,
    videoTokenEstimate,
  });

  const estimate = estimateChatCostFromTokens(
    pricing,
    {
      audioTokens: inputTokens.audioTokens,
      imageTokens: inputTokens.imageTokens,
      maxOutputTokens,
      textTokens: inputTokens.textTokens,
      videoTokens: inputTokens.videoTokens,
    },
    { lookupParams, usdToCnyRate },
  );

  if (!estimate) return undefined;

  return {
    ...estimate,
    audioDurationItemCount: inputTokens.audioDurationItemCount,
    audioFallbackItemCount: inputTokens.audioFallbackItemCount,
    audioTokenEstimateSource: inputTokens.audioTokenEstimateSource,
  };
}
