// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));

const { resolveTTSModelRef } = await import('./index');

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
});
