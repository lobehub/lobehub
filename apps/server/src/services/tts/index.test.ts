// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

const { findTTSModelCard, invalidProviderAPIKeyMessage, resolveTTSModelRef, TTSService } =
  await import('./index');
const { initModelRuntimeFromDB } = await import('@/server/modules/ModelRuntime');
const { default: modelRuntimeLocale } = await import('@/locales/default/modelRuntime');

describe('resolveTTSModelRef', () => {
  it('takes a leading known provider id as the provider', () => {
    expect(resolveTTSModelRef('lobehub/speech-2.8-hd')).toEqual({
      model: 'speech-2.8-hd',
      provider: 'lobehub',
    });
  });

  it('keeps model ids that contain a slash whole', () => {
    expect(resolveTTSModelRef('FunAudioLLM/CosyVoice2-0.5B')).toEqual({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      provider: 'openai',
    });
  });

  it('lets an explicit provider win over the model reference', () => {
    expect(resolveTTSModelRef('speech-2.8-hd', 'lobehub')).toEqual({
      model: 'speech-2.8-hd',
      provider: 'lobehub',
    });
  });

  it("falls back to the built-in card's provider for a bare model id", () => {
    expect(resolveTTSModelRef('speech-2.8-turbo')).toEqual({
      model: 'speech-2.8-turbo',
      provider: 'minimax',
    });
    expect(resolveTTSModelRef('tts-1')).toEqual({ model: 'tts-1', provider: 'openai' });
  });

  it('resolves Fish Audio and Doubao Speech model references (lh generate tts -m)', () => {
    expect(resolveTTSModelRef('fishaudio/s2.1-pro')).toEqual({
      model: 's2.1-pro',
      provider: 'fishaudio',
    });
    expect(resolveTTSModelRef('doubaospeech/seed-tts-2.0')).toEqual({
      model: 'seed-tts-2.0',
      provider: 'doubaospeech',
    });
    expect(resolveTTSModelRef('drama-3')).toEqual({ model: 'drama-3', provider: 'fishaudio' });
    expect(resolveTTSModelRef('seed-tts-2.0')).toEqual({
      model: 'seed-tts-2.0',
      provider: 'doubaospeech',
    });
  });

  it('resolves ElevenLabs model references', () => {
    expect(resolveTTSModelRef('elevenlabs/eleven_v4')).toEqual({
      model: 'eleven_v4',
      provider: 'elevenlabs',
    });
    expect(resolveTTSModelRef('eleven_multilingual_v2')).toEqual({
      model: 'eleven_multilingual_v2',
      provider: 'elevenlabs',
    });
  });
});

describe('invalidProviderAPIKeyMessage', () => {
  it("matches the modelRuntime InvalidProviderAPIKey source copy with the provider's display name", () => {
    const copy = modelRuntimeLocale.InvalidProviderAPIKey.replaceAll('{{provider}}', 'ElevenLabs');

    expect(invalidProviderAPIKeyMessage('elevenlabs')).toBe(
      `${copy}. Set it in Settings → AI Providers → ElevenLabs, or in the server environment.`,
    );
    expect(invalidProviderAPIKeyMessage('elevenlabs')).not.toContain('{{provider}}');
  });

  it('keeps the upstream message when the provider rejected the key', () => {
    expect(invalidProviderAPIKeyMessage('elevenlabs', 'Invalid API key')).toBe(
      'ElevenLabs API Key is incorrect or empty, please check your ElevenLabs API Key and try again (Invalid API key). Set it in Settings → AI Providers → ElevenLabs, or in the server environment.',
    );
  });

  it('names other providers the same way, falling back to the raw id', () => {
    expect(invalidProviderAPIKeyMessage('openai')).toMatch(/^OpenAI API Key is incorrect or empty/);
    expect(invalidProviderAPIKeyMessage('minimax')).toMatch(/^Minimax API Key is incorrect/);
    expect(invalidProviderAPIKeyMessage('my-gateway')).toMatch(/^my-gateway API Key is incorrect/);
  });
});

describe('findTTSModelCard', () => {
  it("returns the provider's own card first", () => {
    expect(findTTSModelCard('fishaudio', 's1')?.providerId).toBe('fishaudio');
  });

  it('lets a built-in provider borrow a vendor card for the same model id', () => {
    expect(findTTSModelCard('lobehub', 's2.1-pro')?.providerId).toBe('fishaudio');
  });

  it("never lends another vendor's card to a custom provider", () => {
    expect(findTTSModelCard('my-custom-tts', 's1')).toBeUndefined();
    expect(findTTSModelCard('my-custom-tts', 'tts-1')).toBeUndefined();
  });
});

describe('TTSService with a custom provider whose model shares a Fish id', () => {
  it('applies no Fish cap, schema or default voice', async () => {
    const textToSpeech = vi.fn(async () => ({
      audio: new ArrayBuffer(1),
      format: 'mp3' as const,
      usage: { inputCharacters: 5000 },
    }));
    vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ textToSpeech } as any);

    const input = 'a'.repeat(5000);
    await new TTSService({} as any, 'user-1').synthesize({
      input,
      model: 's1',
      params: { instructions: 'calm' },
      provider: 'my-custom-tts',
    });

    // Over the Fish cap, with instructions S1 would reject, and no Fish `default` voice.
    expect(textToSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ input, model: 's1', voice: 'alloy', voiceIsDefault: true }),
      expect.anything(),
    );
  });
});
