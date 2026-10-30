import { describe, expect, it } from 'vitest';

import minimaxModels from '../../aiModels/minimax';
import { openaiTTSModels } from '../../aiModels/openai/nonChat';
import { TTSVoiceSchema, validateTTSModelParamsSchema } from '../../standard-parameters';
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
