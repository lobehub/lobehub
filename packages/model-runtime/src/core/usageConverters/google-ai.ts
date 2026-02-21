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
    usage.promptTokenCount && usage.cachedContentTokenCount
      ? usage.promptTokenCount - usage.cachedContentTokenCount
      : undefined;

  const reasoningTokens = usage.thoughtsTokenCount;
  const candidatesDetails = usage.candidatesTokensDetails;
  const totalCandidatesTokens =
    usage.candidatesTokenCount ??
    candidatesDetails?.reduce((sum, detail) => sum + (detail?.tokenCount ?? 0), 0) ??
    0;

  const outputImageTokens = getTokenCount(candidatesDetails, MediaModality.IMAGE) ?? 0;
  const textTokensFromDetails = getTokenCount(candidatesDetails, MediaModality.TEXT);
  const outputTextTokens =
    typeof textTokensFromDetails === 'number' && textTokensFromDetails > 0
      ? textTokensFromDetails
      : Math.max(0, totalCandidatesTokens - outputImageTokens);
  const totalOutputTokens = totalCandidatesTokens + (reasoningTokens ?? 0);

  const normalizedUsage = {
    inputAudioTokens: getTokenCount(usage.promptTokensDetails, MediaModality.AUDIO),
    inputCacheMissTokens,
    inputCachedTokens: usage.cachedContentTokenCount,
    inputImageTokens: getTokenCount(usage.promptTokensDetails, MediaModality.IMAGE),
    inputTextTokens: getTokenCount(usage.promptTokensDetails, MediaModality.TEXT),
    outputImageTokens,
    outputReasoningTokens: reasoningTokens,
    outputTextTokens,
    totalInputTokens: usage.promptTokenCount,
    totalOutputTokens,
    totalTokens: usage.totalTokenCount,
  } satisfies ModelUsage;

  return withUsageCost(normalizedUsage, pricing);
};
