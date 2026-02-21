import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import { MediaModality } from '@google/genai';
import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { convertGoogleAIUsage } from './google-ai';

describe('convertGoogleAIUsage', () => {
  it('should convert usage details with text and image breakdown', () => {
    const usage: GenerateContentResponseUsageMetadata = {
      cachedContentTokenCount: 6,
      candidatesTokenCount: 40,
      candidatesTokensDetails: [
        { modality: MediaModality.TEXT, tokenCount: 30 },
        { modality: MediaModality.IMAGE, tokenCount: 10 },
      ],
      promptTokenCount: 70,
      promptTokensDetails: [
        { modality: MediaModality.TEXT, tokenCount: 60 },
        { modality: MediaModality.IMAGE, tokenCount: 5 },
      ],
      thoughtsTokenCount: 12,
      totalTokenCount: 122,
    };

    const result = convertGoogleAIUsage(usage);

    expect(result).toEqual({
      inputAudioTokens: undefined,
      inputCacheMissTokens: 64,
      inputCachedTokens: 6,
      inputImageTokens: 5,
      inputTextTokens: 60,
      outputImageTokens: 10,
      outputReasoningTokens: 12,
      outputTextTokens: 30,
      totalInputTokens: 70,
      totalOutputTokens: 52,
      totalTokens: 122,
    });
  });

  it('should fall back to total tokens when text modality missing', () => {
    const usage: GenerateContentResponseUsageMetadata = {
      cachedContentTokenCount: undefined,
      candidatesTokenCount: 55,
      candidatesTokensDetails: [{ modality: MediaModality.IMAGE, tokenCount: 15 }],
      promptTokenCount: 40,
      promptTokensDetails: [{ modality: MediaModality.IMAGE, tokenCount: 3 }],
      thoughtsTokenCount: 5,
      totalTokenCount: 100,
    };

    const result = convertGoogleAIUsage(usage);

    expect(result).toEqual({
      inputAudioTokens: undefined,
      inputCacheMissTokens: undefined,
      inputCachedTokens: undefined,
      inputImageTokens: 3,
      inputTextTokens: undefined,
      outputImageTokens: 15,
      outputReasoningTokens: 5,
      outputTextTokens: 40,
      totalInputTokens: 40,
      totalOutputTokens: 60,
      totalTokens: 100,
    });
  });

  it('should attach cost when pricing provided', () => {
    const usage: GenerateContentResponseUsageMetadata = {
      candidatesTokenCount: 100_000,
      promptTokenCount: 200_000,
      totalTokenCount: 300_000,
    };

    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    const result = convertGoogleAIUsage(usage, pricing);

    expect(result.cost).toBeCloseTo(0.4, 10);
  });
});
