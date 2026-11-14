import { describe, expect, it } from 'vitest';

import elevenlabsModels from '../../aiModels/elevenlabs';
import googleModels from '../../aiModels/google';
import minimaxModels from '../../aiModels/minimax';
import { openaiTTSModels } from '../../aiModels/openai/nonChat';
import {
  extractTTSDefaultValues,
  TTSVoiceSchema,
  validateTTSModelParamsSchema,
  validateTTSParams,
} from '../../standard-parameters';
import type { AITTSModelCard } from '../../types/aiModel';

describe('OpenAI TTS model cards', () => {
  it.each(openaiTTSModels.map((card) => [card.id, card]))(
    '%s declares parameters and a valid voice catalog',
    (_id, card) => {
      expect(card.parameters).toBeDefined();
      expect(() => validateTTSModelParamsSchema(card.parameters)).not.toThrow();

      expect(card.voices?.length).toBeGreaterThan(0);
      for (const voice of card.voices!) expect(() => TTSVoiceSchema.parse(voice)).not.toThrow();

      // The default voice must be one the model actually offers.
      const voiceIds = card.voices!.map((voice) => voice.id);
      expect(voiceIds).toContain(card.parameters!.voice!.default);
      expect(new Set(voiceIds).size).toBe(voiceIds.length);
    },
  );

  it('keeps tts-1 voices to the classic set and adds the GPT-4o voices to gpt-4o-mini-tts', () => {
    const voicesOf = (id: string) =>
      openaiTTSModels.find((card) => card.id === id)!.voices!.map((voice) => voice.id);

    expect(voicesOf('tts-1')).toContain('nova');
    expect(voicesOf('tts-1')).not.toContain('marin');
    expect(voicesOf('gpt-4o-mini-tts')).toEqual(expect.arrayContaining(['alloy', 'nova', 'marin']));
  });

  it('only lets gpt-4o-mini-tts take style instructions', () => {
    const tts1 = openaiTTSModels.find((card) => card.id === 'tts-1')!;
    const mini = openaiTTSModels.find((card) => card.id === 'gpt-4o-mini-tts')!;

    expect(tts1.parameters).toHaveProperty('speed');
    expect(tts1.parameters).not.toHaveProperty('instructions');
    expect(mini.parameters).toHaveProperty('instructions');
  });
});

describe('MiniMax TTS model cards', () => {
  const minimaxTTSModels = minimaxModels.filter(
    (card): card is AITTSModelCard => card.type === 'tts',
  );

  it('lists the speech-2.8 / 2.6 / 02 HD and Turbo models', () => {
    expect(minimaxTTSModels.map((card) => card.id)).toEqual([
      'speech-2.8-hd',
      'speech-2.8-turbo',
      'speech-2.6-hd',
      'speech-2.6-turbo',
      'speech-02-hd',
      'speech-02-turbo',
    ]);
  });

  it.each(minimaxTTSModels.map((card) => [card.id, card]))(
    '%s declares valid params, voices and CNY per-character pricing',
    (id, card) => {
      const params = validateTTSModelParamsSchema(card.parameters);
      expect(params.speed).toMatchObject({ max: 2, min: 0.5 });
      expect(params.pitch).toMatchObject({ max: 12, min: -12 });
      expect(params.volume).toMatchObject({ max: 10 });
      expect(params.format?.enum).not.toContain('aac');
      expect(params).not.toHaveProperty('instructions');

      const voiceIds = card.voices!.map((voice) => voice.id);
      expect(voiceIds).toContain(params.voice!.default);
      // The default must also exist on the global endpoint, which lacks e.g. `female-shaonv`.
      expect(params.voice!.default).toBe('Chinese (Mandarin)_Warm_Girl');
      expect(new Set(voiceIds).size).toBe(voiceIds.length);
      for (const voice of card.voices!) expect(() => TTSVoiceSchema.parse(voice)).not.toThrow();

      // ¥3.5 (HD) / ¥2 (Turbo) per 10k characters
      expect(card.pricing).toEqual({
        currency: 'CNY',
        units: [
          {
            name: 'textInput',
            rate: id.endsWith('-hd') ? 350 : 200,
            strategy: 'fixed',
            unit: 'millionCharacters',
          },
        ],
      });
    },
  );

  it('offers at least 10 Mandarin character voices across styles', () => {
    const voices = minimaxTTSModels[0].voices!;
    const ids = voices.map((voice) => voice.id);

    expect(voices.filter((voice) => voice.language === 'zh-CN').length).toBeGreaterThanOrEqual(10);
    // 少女 / 御姐 / 少年 styles
    expect(ids).toEqual(
      expect.arrayContaining(['female-shaonv', 'female-yujie', 'male-qn-qingse', 'clever_boy']),
    );
  });

  it('only exposes the emotions each generation supports', () => {
    const emotionsOf = (id: string) =>
      validateTTSModelParamsSchema(minimaxTTSModels.find((card) => card.id === id)!.parameters)
        .emotion!.enum;

    expect(emotionsOf('speech-2.8-hd')).toContain('fluent');
    expect(emotionsOf('speech-2.8-hd')).not.toContain('whisper');
    expect(emotionsOf('speech-2.6-hd')).toContain('whisper');
    expect(emotionsOf('speech-02-hd')).not.toContain('fluent');
  });
});

describe('ElevenLabs TTS model cards', () => {
  const ttsCards = elevenlabsModels.filter((card): card is AITTSModelCard => card.type === 'tts');
  const cardOf = (id: string) => ttsCards.find((card) => card.id === id)!;

  it('lists the current speech models, enabling v4, Multilingual v2 and Flash v2.5', () => {
    expect(ttsCards).toHaveLength(elevenlabsModels.length);
    expect(ttsCards.map((card) => card.id)).toEqual([
      'eleven_v4',
      'eleven_multilingual_v2',
      'eleven_flash_v2_5',
      'eleven_v3',
      'eleven_flash_v2',
      'eleven_turbo_v2_5',
    ]);
    expect(ttsCards.filter((card) => card.enabled).map((card) => card.id)).toEqual([
      'eleven_v4',
      'eleven_multilingual_v2',
      'eleven_flash_v2_5',
    ]);
    // Deprecated by ElevenLabs in favor of Flash v2.5.
    expect(cardOf('eleven_turbo_v2_5').legacy).toBe(true);
  });

  it.each(ttsCards.map((card) => [card.id, card]))(
    '%s declares valid params, voices and USD per-character pricing',
    (id, card) => {
      const params = validateTTSModelParamsSchema(card.parameters);
      expect(params.format?.enum).toEqual(['mp3', 'opus', 'wav', 'pcm']);
      expect(params.format?.default).toBe('mp3');
      for (const key of ['emotion', 'instructions', 'pitch', 'sampleRate', 'volume'])
        expect(params).not.toHaveProperty(key);

      const voiceIds = card.voices!.map((voice) => voice.id);
      expect(voiceIds).toContain(params.voice!.default);
      expect(new Set(voiceIds).size).toBe(voiceIds.length);
      for (const voice of card.voices!) expect(() => TTSVoiceSchema.parse(voice)).not.toThrow();

      // $0.08 (v4 / v3 / Multilingual v2) or $0.04 (Flash / Turbo) per 1k characters
      const rate = /flash|turbo/.test(id) ? 40 : 80;
      expect(card.isOfficial).toBe(true);
      expect(card.pricing).toEqual({
        units: [{ name: 'textInput', rate, strategy: 'fixed', unit: 'millionCharacters' }],
      });
    },
  );

  it('only offers speed (0.7–1.2) on the models that accept it', () => {
    for (const id of ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2']) {
      expect(validateTTSModelParamsSchema(cardOf(id).parameters).speed).toMatchObject({
        default: 1,
        max: 1.2,
        min: 0.7,
      });
    }

    // Eleven v3 and v4 have no speed setting.
    for (const id of ['eleven_v4', 'eleven_v3']) {
      const schema = cardOf(id).parameters!;
      expect(schema).not.toHaveProperty('speed');
      expect(validateTTSParams(schema, { speed: 1.1 })).toEqual([
        { key: 'speed', reason: 'not supported by this model' },
      ]);
    }

    const flash = cardOf('eleven_flash_v2_5').parameters!;
    expect(validateTTSParams(flash, { format: 'wav', speed: 1.2 })).toEqual([]);
    expect(validateTTSParams(flash, { speed: 1.5 })).toEqual([
      { key: 'speed', reason: 'must be between 0.7 and 1.2' },
    ]);
    expect(validateTTSParams(flash, { format: 'aac' })).toHaveLength(1);
    expect(extractTTSDefaultValues(flash)).toEqual({ format: 'mp3', speed: 1 });
  });

  it('ships the long-lived replacements for the Default voices that expire on 2026-12-31', () => {
    const voices = cardOf('eleven_v4').voices!;
    const ids = voices.map((voice) => voice.id);

    expect(voices).toHaveLength(20);
    expect(voices.every((voice) => voice.language === 'multilingual')).toBe(true);
    // Replacements for Sarah, George and Daniel.
    expect(ids).toEqual(
      expect.arrayContaining([
        'OZ0L6eISlOejga3XjDFt',
        '6WwXjDDEMyNmFG95zycZ',
        'fnYMz3F5gMEDGMWcH1ex',
      ]),
    );
    // Roger is the free-tier-callable default and the only legacy Default voice offered.
    expect(voices[0].id).toBe('CwhRBWXzGAHq8TQ4Fs17');
    expect(cardOf('eleven_v4').parameters?.voice?.default).toBe('CwhRBWXzGAHq8TQ4Fs17');
    // Other legacy Default voice ids (Sarah, George, Rachel) must not be offered.
    for (const legacyId of ['EXAVITQu4vr4xnSDxMaL', 'JBFqnCBsd6RMkjVDRZzb', '21m00Tcm4TlvDq8ikWAM'])
      expect(ids).not.toContain(legacyId);
  });
});

describe('Google Gemini TTS model cards', () => {
  const googleTTSModels = googleModels.filter(
    (card): card is AITTSModelCard => card.type === 'tts',
  );

  it('lists the Gemini 3.8 TTS models, and 2.5 preview TTS as legacy', () => {
    expect(googleTTSModels.map((card) => [card.id, !!card.enabled, !!card.legacy])).toEqual([
      ['gemini-3.8-flash-tts', true, false],
      ['gemini-3.8-flash-lite-tts', true, false],
      ['gemini-2.5-flash-preview-tts', false, true],
      ['gemini-2.5-pro-preview-tts', false, true],
    ]);
  });

  it.each(googleTTSModels.map((card) => [card.id, card]))(
    '%s offers the 30 prebuilt voices with Kore as the default',
    (_id, card) => {
      expect(() => validateTTSModelParamsSchema(card.parameters)).not.toThrow();
      for (const voice of card.voices!) expect(() => TTSVoiceSchema.parse(voice)).not.toThrow();

      const voiceIds = card.voices!.map((voice) => voice.id);
      expect(voiceIds).toHaveLength(30);
      expect(new Set(voiceIds).size).toBe(30);
      expect(voiceIds).toEqual(
        expect.arrayContaining(['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Sulafat']),
      );
      expect(card.parameters!.voice!.default).toBe('Kore');
      expect(voiceIds).toContain(card.parameters!.voice!.default);
    },
  );

  it('declares only the params the runtime honors: format and style instructions', () => {
    for (const card of googleTTSModels) {
      expect(Object.keys(card.parameters!).sort()).toEqual(['format', 'instructions', 'voice']);
      expect(card.parameters!.format).toEqual({ default: 'mp3', enum: ['mp3', 'wav', 'pcm'] });
      expect(extractTTSDefaultValues(card.parameters!)).toEqual({
        format: 'mp3',
        instructions: '',
      });
      // Gemini has no numeric speed: a legacy speed must be reported, not silently dropped.
      expect(validateTTSParams(card.parameters!, { speed: 1.5 })).toEqual([
        { key: 'speed', reason: 'not supported by this model' },
      ]);
      expect(validateTTSParams(card.parameters!, { format: 'opus' })).toHaveLength(1);
      expect(
        validateTTSParams(card.parameters!, { format: 'mp3', instructions: 'speak slowly' }),
      ).toEqual([]);
    }
  });

  it('bills text input and audio output per million tokens', () => {
    const units = Object.fromEntries(
      googleTTSModels.map((card) => [
        card.id,
        card.pricing!.units.map((unit) => [unit.name, unit.unit, (unit as any).rate]),
      ]),
    );

    expect(units).toEqual({
      'gemini-3.8-flash-lite-tts': [
        ['textInput', 'millionTokens', 0.5],
        ['audioOutput', 'millionTokens', 6],
      ],
      'gemini-3.8-flash-tts': [
        ['textInput', 'millionTokens', 0.5],
        ['audioOutput', 'millionTokens', 9],
      ],
      'gemini-2.5-flash-preview-tts': [
        ['textInput', 'millionTokens', 0.5],
        ['audioOutput', 'millionTokens', 10],
      ],
      'gemini-2.5-pro-preview-tts': [
        ['textInput', 'millionTokens', 1],
        ['audioOutput', 'millionTokens', 20],
      ],
    });
  });
});
