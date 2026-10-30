import { describe, expect, it } from 'vitest';

import { openaiTTSModels } from '../../aiModels/openai/nonChat';
import { TTSVoiceSchema, validateTTSModelParamsSchema } from '../../standard-parameters';

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
