// @vitest-environment node
import { LobeElevenLabsAI, ModelRuntime } from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeWithUserPayload } from './index';

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({ ELEVENLABS_API_KEY: 'test-elevenlabs-key' })),
}));

describe('initModelRuntimeWithUserPayload: ElevenLabs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the user API key and endpoint', () => {
    const runtime = initModelRuntimeWithUserPayload(ModelProvider.ElevenLabs, {
      apiKey: 'user-elevenlabs-key',
      baseURL: 'https://api.eu.residency.elevenlabs.io',
    });

    expect(runtime).toBeInstanceOf(ModelRuntime);
    expect(runtime['_runtime']).toBeInstanceOf(LobeElevenLabsAI);
    expect(runtime['_runtime']['apiKey']).toBe('user-elevenlabs-key');
    expect(runtime['_runtime'].baseURL).toBe('https://api.eu.residency.elevenlabs.io');
  });

  it('falls back to ELEVENLABS_API_KEY and ELEVENLABS_PROXY_URL without a user key', () => {
    expect(initModelRuntimeWithUserPayload(ModelProvider.ElevenLabs, {})['_runtime']).toMatchObject(
      { apiKey: 'test-elevenlabs-key', baseURL: 'https://api.elevenlabs.io' },
    );

    vi.stubEnv('ELEVENLABS_PROXY_URL', 'https://proxy.example.com/v1');
    expect(initModelRuntimeWithUserPayload(ModelProvider.ElevenLabs, {})['_runtime'].baseURL).toBe(
      'https://proxy.example.com',
    );
  });

  it('rejects a user endpoint without a key instead of sending the server key there', () => {
    expect(() =>
      initModelRuntimeWithUserPayload(ModelProvider.ElevenLabs, {
        baseURL: 'https://proxy.example.com',
      }),
    ).toThrow(expect.objectContaining({ errorType: 'InvalidProviderAPIKey' }));
  });
});
