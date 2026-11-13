import { describe, expect, it } from 'vitest';

import doubaospeechModels from '../../aiModels/doubaospeech';
import fishaudioModels from '../../aiModels/fishaudio';
import {
  TTSVoiceSchema,
  validateTTSModelParamsSchema,
  validateTTSParams,
} from '../../standard-parameters';
import type { AITTSModelCard } from '../../types/aiModel';
import {
  DOUBAO_SPEECH_DEFAULT_VOICE_ID,
  DOUBAO_SPEECH_VOICE_IDS,
  FISH_AUDIO_DEFAULT_VOICE_ID,
} from '../ttsParameters';

const fishCards = fishaudioModels as AITTSModelCard[];
const doubaoCards = doubaospeechModels as AITTSModelCard[];

describe.each([
  ['Fish Audio', fishCards],
  ['Doubao Speech', doubaoCards],
])('%s TTS model cards', (_, cards) => {
  it.each(cards.map((card) => [card.id, card]))(
    '%s declares parameters, a valid voice catalog and per-character pricing',
    (_id, card) => {
      expect(card.type).toBe('tts');
      expect(card.isOfficial).toBe(true);
      expect(() => validateTTSModelParamsSchema(card.parameters)).not.toThrow();

      expect(card.voices?.length).toBeGreaterThan(0);
      for (const voice of card.voices!) expect(() => TTSVoiceSchema.parse(voice)).not.toThrow();

      const voiceIds = card.voices!.map((voice) => voice.id);
      expect(voiceIds).toContain(card.parameters!.voice!.default);
      expect(new Set(voiceIds).size).toBe(voiceIds.length);

      expect(card.pricing?.units).toEqual([
        expect.objectContaining({
          name: 'textInput',
          strategy: 'fixed',
          unit: 'millionCharacters',
        }),
      ]);
      // aac and flac are produced by neither vendor.
      expect(card.parameters!.format!.enum).not.toContain('aac');
      expect(card.parameters!.format!.enum).not.toContain('flac');
    },
  );
});

describe('Fish Audio TTS model cards', () => {
  it('lists S2.1 Pro, Drama 3 (enabled), S2 Pro and the legacy S1 at official prices', () => {
    expect(
      fishCards.map(({ enabled, id, legacy, pricing }) => ({
        enabled: !!enabled,
        id,
        legacy: !!legacy,
        rate: (pricing!.units[0] as { rate: number }).rate,
      })),
    ).toEqual([
      { enabled: true, id: 's2.1-pro', legacy: false, rate: 15 },
      { enabled: true, id: 'drama-3', legacy: false, rate: 50 },
      { enabled: false, id: 's2-pro', legacy: false, rate: 15 },
      { enabled: false, id: 's1', legacy: true, rate: 15 },
    ]);
    expect(fishCards.every((card) => !card.pricing?.currency)).toBe(true);
  });

  it('bundles no community voices, only the Fish Audio default', () => {
    for (const card of fishCards) {
      expect(card.voices!.map((voice) => voice.id)).toEqual([FISH_AUDIO_DEFAULT_VOICE_ID]);
    }
  });

  it('accepts speed 0.5–2 and directions only on the S2 family and Drama 3', () => {
    const byId = Object.fromEntries(fishCards.map((card) => [card.id, card]));

    expect(validateTTSParams(byId['s2.1-pro'].parameters!, { speed: 2 })).toEqual([]);
    expect(validateTTSParams(byId['s2.1-pro'].parameters!, { speed: 2.5 })).not.toEqual([]);
    expect(validateTTSParams(byId['drama-3'].parameters!, { instructions: 'calm' })).toEqual([]);
    expect(validateTTSParams(byId['s1'].parameters!, { instructions: 'calm' })).not.toEqual([]);
    expect(validateTTSParams(byId['s2.1-pro'].parameters!, { pitch: 1 })).not.toEqual([]);
  });
});

describe('Doubao Speech TTS model cards', () => {
  it('lists Seed-TTS 2.0 priced at 300 CNY per million characters', () => {
    expect(doubaoCards).toHaveLength(1);
    expect(doubaoCards[0]).toMatchObject({
      enabled: true,
      id: 'seed-tts-2.0',
      pricing: {
        currency: 'CNY',
        units: [{ name: 'textInput', rate: 300, strategy: 'fixed', unit: 'millionCharacters' }],
      },
    });
  });

  it('only bundles official 2.0 voices, which the seed-tts-2.0 resource can speak', () => {
    const voices = doubaoCards[0].voices!;

    expect(voices.every((voice) => voice.id.endsWith('_uranus_bigtts'))).toBe(true);
    expect(voices.map((voice) => voice.id)).toEqual([...DOUBAO_SPEECH_VOICE_IDS]);
    expect(voices[0].id).toBe(DOUBAO_SPEECH_DEFAULT_VOICE_ID);
    expect(voices.some((voice) => voice.language === 'zh-CN')).toBe(true);
    expect(voices.some((voice) => voice.language.startsWith('en'))).toBe(true);
  });

  it('validates speed, volume and pitch ranges before the request', () => {
    const schema = doubaoCards[0].parameters!;

    expect(validateTTSParams(schema, { pitch: -12, speed: 0.5, volume: 2 })).toEqual([]);
    expect(validateTTSParams(schema, { speed: 3 })).not.toEqual([]);
    expect(validateTTSParams(schema, { volume: 0.1 })).not.toEqual([]);
    expect(validateTTSParams(schema, { pitch: 13 })).not.toEqual([]);
    expect(validateTTSParams(schema, { sampleRate: 12_345 })).not.toEqual([]);
    expect(validateTTSParams(schema, { emotion: 'happy' })).not.toEqual([]);
  });
});
