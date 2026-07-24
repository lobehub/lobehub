import type { ModelTokensUsage } from '@lobechat/types';
import type { Pricing, PricingUnitName } from 'model-bank';
import { estimateTokenCount } from 'tokenx';

import type { ChatCompletionTool, OpenAIChatMessage } from '../../../types/chat';
import type { ComputeChatCostOptions, PricingComputationResult } from './computeChatCost';
import { computeChatCost } from './computeChatCost';

const DEFAULT_IMAGE_INPUT_TOKEN_ESTIMATE = 1000;
const DEFAULT_VIDEO_INPUT_TOKEN_ESTIMATE = 1000;
const OUTPUT_INPUT_RATIO = 0.5;
const OUTPUT_TOKEN_CAP = 8192;

export interface ChatInputTokenEstimate {
  imageTokens: number;
  textTokens: number;
  totalTokens: number;
  videoTokens: number;
}

export interface EstimateOpenAIChatInputTokensOptions {
  /**
   * Conservative token estimate for each image input when exact image accounting is unavailable.
   */
  imageTokenEstimate?: number;
  /**
   * Tool definitions are counted as input prompt tokens because providers receive them with the
   * chat request.
   */
  tools?: ChatCompletionTool[];
  /**
   * Conservative token estimate for each video input when exact video accounting is unavailable.
   */
  videoTokenEstimate?: number;
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
  textTokens: number;
  videoTokens?: number;
}

/**
 * Cost estimate for budget pre-checks and UI hints. This is intentionally approximate and should
 * not be treated as the authoritative charged amount.
 */
export interface ChatCostEstimate extends PricingComputationResult {
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

const estimateSerializableTokens = (value: unknown): number => {
  if (value === undefined || value === null) return 0;

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text ? estimateTokenCount(text) : 0;
};

const hasPricingUnit = (pricing: Pricing | undefined, unitName: PricingUnitName) =>
  pricing?.units.some((unit) => unit.name === unitName) ?? false;

/**
 * Estimates output tokens for budget pre-checks and UI hints.
 *
 * The default heuristic assumes output is half of total input tokens. A request/model limit caps
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
 * conservative per-image estimate; use provider usage plus `computeChatCost` for final billing.
 */
export function estimateOpenAIChatInputTokens(
  messages: OpenAIChatMessage[],
  options: EstimateOpenAIChatInputTokensOptions = {},
): ChatInputTokenEstimate {
  const imageTokenEstimate = options.imageTokenEstimate ?? DEFAULT_IMAGE_INPUT_TOKEN_ESTIMATE;
  const videoTokenEstimate = options.videoTokenEstimate ?? DEFAULT_VIDEO_INPUT_TOKEN_ESTIMATE;
  let textTokens = 0;
  let imageTokens = 0;
  let videoTokens = 0;

  for (const message of messages) {
    textTokens += estimateSerializableTokens(message.role);
    textTokens += estimateSerializableTokens(message.name);
    textTokens += estimateSerializableTokens(message.tool_call_id);
    textTokens += estimateSerializableTokens(message.tool_calls);
    textTokens += estimateSerializableTokens(message.reasoning?.content);

    if (typeof message.content === 'string') {
      textTokens += estimateSerializableTokens(message.content);
      continue;
    }

    if (!Array.isArray(message.content)) {
      textTokens += estimateSerializableTokens(message.content);
      continue;
    }

    for (const part of message.content) {
      if (part.type === 'text') {
        textTokens += estimateSerializableTokens(part.text);
        continue;
      }

      if (part.type === 'image_url') {
        imageTokens += imageTokenEstimate;
        continue;
      }

      if (part.type === 'video_url') {
        videoTokens += videoTokenEstimate;
        continue;
      }

      textTokens += estimateSerializableTokens(part);
    }
  }

  textTokens += estimateSerializableTokens(options.tools);

  return {
    imageTokens,
    textTokens,
    totalTokens: textTokens + imageTokens + videoTokens,
    videoTokens,
  };
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
    tools,
    imageTokenEstimate,
    lookupParams,
    maxOutputTokens,
    usdToCnyRate,
    videoTokenEstimate,
  } = options;
  const inputTokens = estimateOpenAIChatInputTokens(messages, {
    imageTokenEstimate,
    tools,
    videoTokenEstimate,
  });

  return estimateChatCostFromTokens(
    pricing,
    {
      imageTokens: inputTokens.imageTokens,
      maxOutputTokens,
      textTokens: inputTokens.textTokens,
      videoTokens: inputTokens.videoTokens,
    },
    { lookupParams, usdToCnyRate },
  );
}
