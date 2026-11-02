import type { Pricing } from 'model-bank';
import openaiModels from 'model-bank/openai';
import { describe, expect, it } from 'vitest';

import {
  convertOpenAISpeechTokenUsage,
  convertTextToSpeechUsage,
  countTextToSpeechCharacters,
  isTokenBilledTextToSpeech,
} from './tts';

const pricingOf = (id: string) =>
  openaiModels.find((model: { id: string }) => model.id === id)?.pricing as Pricing;

describe('countTextToSpeechCharacters', () => {
  it('counts code points so CJK characters and emoji are one character each', () => {
    expect(countTextToSpeechCharacters('hello')).toBe(5);
    expect(countTextToSpeechCharacters('你好，世界')).toBe(5);
    expect(countTextToSpeechCharacters('hi 👋')).toBe(4);
  });
});

describe('isTokenBilledTextToSpeech', () => {
  it('tells token-billed from character-billed pricing', () => {
    expect(isTokenBilledTextToSpeech(pricingOf('tts-1'))).toBe(false);
    expect(isTokenBilledTextToSpeech(pricingOf('gpt-4o-mini-tts'))).toBe(true);
    expect(isTokenBilledTextToSpeech(undefined)).toBe(false);
  });
});

describe('convertTextToSpeechUsage', () => {
  it('prices tts-1 by input characters ($15 / 1M characters)', () => {
    const input = 'a'.repeat(1000);

    expect(convertTextToSpeechUsage(input, pricingOf('tts-1'))).toEqual({
      cost: 0.015,
      inputCharacters: 1000,
    });
  });

  it('prices tts-1-hd at its own rate ($30 / 1M characters)', () => {
    expect(convertTextToSpeechUsage('你'.repeat(1000), pricingOf('tts-1-hd'))).toEqual({
      cost: 0.03,
      inputCharacters: 1000,
    });
  });

  it('prices gpt-4o-mini-tts by reported text input and audio output tokens', () => {
    const tokenUsage = convertOpenAISpeechTokenUsage({
      input_tokens: 1000,
      output_tokens: 10_000,
      total_tokens: 11_000,
    });

    // 1000 × $0.6/1M + 10000 × $12/1M = $0.0006 + $0.12
    expect(convertTextToSpeechUsage('hello', pricingOf('gpt-4o-mini-tts'), tokenUsage)).toEqual({
      cost: 0.1206,
      inputCharacters: 5,
      inputTextTokens: 1000,
      outputAudioTokens: 10_000,
      totalInputTokens: 1000,
      totalOutputTokens: 10_000,
      totalTokens: 11_000,
    });
  });

  it('leaves cost unset for a token-billed model without reported tokens', () => {
    expect(convertTextToSpeechUsage('hello', pricingOf('gpt-4o-mini-tts'))).toEqual({
      inputCharacters: 5,
    });
  });

  it('reports characters without cost when the model has no pricing', () => {
    expect(convertTextToSpeechUsage('hello')).toEqual({ inputCharacters: 5 });
  });
});

describe('convertOpenAISpeechTokenUsage', () => {
  it('derives totalTokens when the provider omits it', () => {
    expect(convertOpenAISpeechTokenUsage({ input_tokens: 3, output_tokens: 7 })).toMatchObject({
      totalTokens: 10,
    });
  });

  it('returns undefined for missing or partial usage', () => {
    expect(convertOpenAISpeechTokenUsage(undefined)).toBeUndefined();
    expect(convertOpenAISpeechTokenUsage({ input_tokens: 3 })).toBeUndefined();
  });
});
