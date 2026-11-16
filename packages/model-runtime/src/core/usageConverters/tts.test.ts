import type { Pricing } from 'model-bank';
import fishaudioModels from 'model-bank/fishaudio';
import openaiModels from 'model-bank/openai';
import { describe, expect, it } from 'vitest';

import { FISH_AUDIO_MODELS } from '../../providers/fishaudio/createSpeech';
import {
  convertOpenAISpeechTokenUsage,
  convertTextToSpeechUsage,
  countFishAudioBilledBytes,
  countMiniMaxSpeechCharacters,
  countTextToSpeechCharacters,
  isFishAudioSpeechModel,
  isMiniMaxSpeechModel,
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

describe('countMiniMaxSpeechCharacters', () => {
  it('counts a Chinese character as 2 and everything else as 1', () => {
    expect(countMiniMaxSpeechCharacters('你好，世界')).toBe(9);
    expect(countMiniMaxSpeechCharacters('hello')).toBe(5);
    expect(countMiniMaxSpeechCharacters('hi 👋')).toBe(4);
  });
});

describe('isMiniMaxSpeechModel', () => {
  it('matches MiniMax speech catalog and gateway ids only', () => {
    expect(isMiniMaxSpeechModel('speech-2.8-hd')).toBe(true);
    expect(isMiniMaxSpeechModel('minimax/speech-2.8-turbo')).toBe(true);
    expect(isMiniMaxSpeechModel('tts-1')).toBe(false);
    expect(isMiniMaxSpeechModel('openai/gpt-4o-mini-tts')).toBe(false);
    expect(isMiniMaxSpeechModel(undefined)).toBe(false);
  });
});

describe('countFishAudioBilledBytes', () => {
  it('counts UTF-8 bytes: a Chinese character is 3, an emoji 4', () => {
    expect(countFishAudioBilledBytes('hello')).toBe(5);
    expect(countFishAudioBilledBytes('你好，世界')).toBe(15);
    expect(countFishAudioBilledBytes('hi 👋')).toBe(7);
  });
});

describe('isFishAudioSpeechModel', () => {
  it('matches every Fish Audio card and runtime model, by catalog and gateway id', () => {
    const ids = [...fishaudioModels.map((model: { id: string }) => model.id), ...FISH_AUDIO_MODELS];

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(isFishAudioSpeechModel(id)).toBe(true);
      expect(isFishAudioSpeechModel(`fish-audio/${id}`)).toBe(true);
    }
  });

  it('rejects other models and look-alike ids', () => {
    expect(isFishAudioSpeechModel('tts-1')).toBe(false);
    expect(isFishAudioSpeechModel('speech-2.8-hd')).toBe(false);
    expect(isFishAudioSpeechModel('s2')).toBe(false);
    expect(isFishAudioSpeechModel('s1-mini')).toBe(false);
    expect(isFishAudioSpeechModel('other/s1')).toBe(false);
    expect(isFishAudioSpeechModel(undefined)).toBe(false);
  });
});
