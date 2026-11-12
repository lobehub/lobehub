// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

const { invalidProviderAPIKeyMessage, resolveTTSModelRef } = await import('./index');
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
