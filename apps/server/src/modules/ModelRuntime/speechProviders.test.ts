// @vitest-environment node
import { LobeDoubaoSpeechAI, LobeFishAudioAI, ModelRuntime } from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildPayloadFromKeyVaults, initModelRuntimeWithUserPayload } from './index';

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({
    DOUBAOSPEECH_API_KEY: 'server-doubao-key',
    FISHAUDIO_API_KEY: 'server-fish-key',
  })),
}));

describe('initModelRuntimeWithUserPayload: Fish Audio', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the user API key and endpoint, else FISHAUDIO_API_KEY', () => {
    const runtime = initModelRuntimeWithUserPayload(ModelProvider.FishAudio, {
      apiKey: 'user-fish-key',
      baseURL: 'https://proxy.example.com',
    });

    expect(runtime).toBeInstanceOf(ModelRuntime);
    expect(runtime['_runtime']).toBeInstanceOf(LobeFishAudioAI);
    expect(runtime['_runtime']).toMatchObject({
      apiKey: 'user-fish-key',
      baseURL: 'https://proxy.example.com',
    });
    expect(initModelRuntimeWithUserPayload(ModelProvider.FishAudio, {})['_runtime']).toMatchObject({
      apiKey: 'server-fish-key',
      baseURL: 'https://api.fish.audio',
    });
  });
});

describe('Doubao Speech credentials', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards the legacy App ID + Access Token from the key vault', () => {
    expect(
      buildPayloadFromKeyVaults(
        { accessToken: 'token', apiKey: undefined, appId: 'app', baseURL: 'https://x.example.com' },
        ModelProvider.DoubaoSpeech,
      ),
    ).toEqual({
      apiKey: undefined,
      baseURL: 'https://x.example.com',
      doubaoSpeechAccessToken: 'token',
      doubaoSpeechAppId: 'app',
      runtimeProvider: ModelProvider.DoubaoSpeech,
    });
  });

  it('initializes from the user API key or the legacy credentials', () => {
    const withKey = initModelRuntimeWithUserPayload(ModelProvider.DoubaoSpeech, {
      apiKey: 'user-key',
    })['_runtime'];
    expect(withKey).toBeInstanceOf(LobeDoubaoSpeechAI);
    expect(withKey['credentials']).toMatchObject({ apiKey: 'user-key' });

    const legacy = initModelRuntimeWithUserPayload(ModelProvider.DoubaoSpeech, {
      doubaoSpeechAccessToken: 'token',
      doubaoSpeechAppId: 'app',
    })['_runtime'];
    expect(legacy['credentials']).toMatchObject({ accessToken: 'token', appId: 'app' });
    expect(legacy['credentials'].apiKey).toBeFalsy();
  });

  it('falls back to DOUBAOSPEECH_API_KEY and DOUBAOSPEECH_PROXY_URL without user credentials', () => {
    vi.stubEnv('DOUBAOSPEECH_PROXY_URL', 'https://proxy.example.com/api/v3');

    const runtime = initModelRuntimeWithUserPayload(ModelProvider.DoubaoSpeech, {})['_runtime'];
    expect(runtime['credentials']).toMatchObject({ apiKey: 'server-doubao-key' });
    expect(runtime.baseURL).toBe('https://proxy.example.com');
  });

  it('rejects incomplete user credentials instead of mixing in the server key', () => {
    expect(() =>
      initModelRuntimeWithUserPayload(ModelProvider.DoubaoSpeech, { doubaoSpeechAppId: 'app' }),
    ).toThrow(expect.objectContaining({ errorType: 'InvalidProviderAPIKey' }));
  });
});
