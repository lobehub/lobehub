import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../../aiModels';
import { validateMusicModelParamsSchema } from '../../standard-parameters/music';
import { minimaxMusicCoverSchema, minimaxMusicSchema, sunoV6MusicSchema } from '../musicParameters';

const musicCards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.type === 'text2music');

describe('music parameter schemas', () => {
  it.each([
    ['minimaxMusicSchema', minimaxMusicSchema],
    ['minimaxMusicCoverSchema', minimaxMusicCoverSchema],
    ['sunoV6MusicSchema', sunoV6MusicSchema],
  ])('%s is a valid standard music schema', (_, schema) => {
    expect(() => validateMusicModelParamsSchema(schema)).not.toThrow();
  });

  it('MiniMax text-to-music takes lyrics, instrumental and audio settings but no reference', () => {
    const parsed = validateMusicModelParamsSchema(minimaxMusicSchema);

    expect(Object.keys(parsed).sort()).toEqual(
      ['autoLyrics', 'bitrate', 'format', 'instrumental', 'lyrics', 'prompt', 'sampleRate'].sort(),
    );
    expect(parsed.lyrics?.maxLength).toBe(3500);
    expect(parsed.format?.enum).toEqual(['mp3', 'wav', 'pcm']);
  });

  it('MiniMax music-cover requires a reference track and has no instrumental switch', () => {
    const parsed = validateMusicModelParamsSchema(minimaxMusicCoverSchema);

    expect(parsed.referenceAudioUrl).toMatchObject({
      maxDuration: 360,
      maxFileSize: 50 * 1024 * 1024,
      minDuration: 6,
      required: true,
    });
    expect(parsed.instrumental).toBeUndefined();
    expect(parsed.autoLyrics).toBeUndefined();
  });

  it('Suno takes title, style, negative style and duration but no audio settings', () => {
    const parsed = validateMusicModelParamsSchema(sunoV6MusicSchema);

    expect(parsed.title?.maxLength).toBe(80);
    expect(parsed.style?.maxLength).toBe(1000);
    expect(parsed.negativeStyle).toBeDefined();
    expect(parsed.duration).toMatchObject({ max: 360, min: 10 });
    expect(parsed.format).toBeUndefined();
    expect(parsed.referenceAudioUrl).toBeUndefined();
  });

  it('every built-in text2music card carries a valid schema, a per-song price and an output count', () => {
    expect(musicCards.length).toBeGreaterThan(0);

    for (const card of musicCards) {
      expect(() => validateMusicModelParamsSchema(card.parameters), card.id).not.toThrow();
      expect(card.pricing?.units, card.id).toEqual([
        expect.objectContaining({ name: 'musicGeneration', strategy: 'fixed', unit: 'song' }),
      ]);
      expect(card.outputsPerRequest, card.id).toBeGreaterThanOrEqual(1);
      expect(card.description, card.id).toBeTruthy();
    }
  });
});

describe('MiniMax music models', () => {
  const minimaxMusic = musicCards.filter((card) => card.providerId === 'minimax');

  it('lists the current music models, disabled by default', () => {
    expect(minimaxMusic.map((card) => card.id)).toEqual(['music-3.0', 'music-2.6', 'music-cover']);
    // MiniMax no longer sells the music API to new accounts.
    expect(minimaxMusic.every((card) => !card.enabled)).toBe(true);
  });

  it('prices each song at ¥1', () => {
    for (const card of minimaxMusic) {
      expect(card.pricing).toEqual({
        currency: 'CNY',
        units: [{ name: 'musicGeneration', rate: 1, strategy: 'fixed', unit: 'song' }],
      });
      expect(card.outputsPerRequest).toBe(1);
    }
  });

  it('only music-cover takes reference audio', () => {
    const withReference = minimaxMusic.filter(
      (card) => (card.parameters as { referenceAudioUrl?: unknown })?.referenceAudioUrl,
    );
    expect(withReference.map((card) => card.id)).toEqual(['music-cover']);
  });

  it('leaves the MiniMax TTS cards untouched', () => {
    const tts = LOBE_DEFAULT_MODEL_LIST.filter(
      (card) => card.providerId === 'minimax' && card.type === 'tts',
    );
    expect(tts.map((card) => card.id)).toEqual([
      'speech-2.8-hd',
      'speech-2.8-turbo',
      'speech-2.6-hd',
      'speech-2.6-turbo',
      'speech-02-hd',
      'speech-02-turbo',
    ]);
  });
});
