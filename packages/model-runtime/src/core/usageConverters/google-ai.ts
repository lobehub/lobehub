import type { GenerateContentResponseUsageMetadata, ModalityTokenCount } from '@google/genai';
import { MediaModality } from '@google/genai';
import type { ModelUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

import { withUsageCost } from './utils/withUsageCost';

const getTokenCount = (details: ModalityTokenCount[] | undefined, modality: MediaModality) => {
  return details?.find((detail) => detail?.modality === modality)?.tokenCount;
};

export const convertGoogleAIUsage = (
  usage: GenerateContentResponseUsageMetadata,
  pricing?: Pricing,
): ModelUsage => {
  const inputCacheMissTokens =
    typeof usage.promptTokenCount === 'number' && typeof usage.cachedContentTokenCount === 'number'
      ? usage.promptTokenCount - usage.cachedContentTokenCount
      : undefined;

  const reasoningTokens = usage.thoughtsTokenCount;
  const candidatesDetails = usage.candidatesTokensDetails;
  const totalCandidatesTokens =
    usage.candidatesTokenCount ??
    candidatesDetails?.reduce((sum, detail) => sum + (detail?.tokenCount ?? 0), 0) ??
    0;

  // toolUsePromptTokenCount represents tokens consumed for tool call prompts (input side)
  const toolUseTokens = usage.toolUsePromptTokenCount;

  const outputImageTokens = getTokenCount(candidatesDetails, MediaModality.IMAGE) ?? 0;
  const textTokensFromDetails = getTokenCount(candidatesDetails, MediaModality.TEXT);
  const outputTextTokens =
    typeof textTokensFromDetails === 'number' && textTokensFromDetails > 0
      ? textTokensFromDetails
      : Math.max(0, totalCandidatesTokens - outputImageTokens);
  const totalOutputTokens = totalCandidatesTokens + (reasoningTokens ?? 0);

  const normalizedUsage = {
    inputAudioTokens: getTokenCount(usage.promptTokensDetails, MediaModality.AUDIO),
    inputCachedAudioTokens: getTokenCount(usage.cacheTokensDetails, MediaModality.AUDIO),
    inputCachedImageTokens: getTokenCount(usage.cacheTokensDetails, MediaModality.IMAGE),
    inputCachedTextTokens: getTokenCount(usage.cacheTokensDetails, MediaModality.TEXT),
    inputCacheMissTokens,
    inputCachedTokens: usage.cachedContentTokenCount,
    inputCachedVideoTokens: getTokenCount(usage.cacheTokensDetails, MediaModality.VIDEO),
    inputImageTokens: getTokenCount(usage.promptTokensDetails, MediaModality.IMAGE),
    inputTextTokens: getTokenCount(usage.promptTokensDetails, MediaModality.TEXT),
    inputToolTokens: toolUseTokens,
    inputVideoTokens: getTokenCount(usage.promptTokensDetails, MediaModality.VIDEO),
    outputImageTokens,
    outputReasoningTokens: reasoningTokens,
    outputTextTokens,
    totalInputTokens: toolUseTokens
      ? (usage.promptTokenCount ?? 0) + toolUseTokens
      : usage.promptTokenCount,
    totalOutputTokens,
    totalTokens: usage.totalTokenCount,
  } satisfies ModelUsage;

  return withUsageCost(normalizedUsage, pricing);
};
