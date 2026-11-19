// @vitest-environment node
import { LobeGmicloudSpeechAI, ModelRuntime } from '@lobechat/model-runtime';
import { ModelProvider } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initModelRuntimeWithUserPayload } from './index';

vi.mock('@/server/globalConfig', () => ({ getServerAiProviderConfig: vi.fn() }));
vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(() => ({ GMICLOUDSPEECH_API_KEY: 'test-gmicloud-key' })),
}));

describe('initModelRuntimeWithUserPayload: GMI Cloud Speech', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the user API key and endpoint', () => {
    const runtime = initModelRuntimeWithUserPayload(ModelProvider.GmicloudSpeech, {
      apiKey: 'user-gmi-key',
      baseURL: 'https://proxy.example.com',
    });

    expect(runtime).toBeInstanceOf(ModelRuntime);
    expect(runtime['_runtime']).toBeInstanceOf(LobeGmicloudSpeechAI);
    expect(runtime['_runtime']['apiKey']).toBe('user-gmi-key');
    expect(runtime['_runtime'].baseURL).toBe('https://proxy.example.com');
  });

  it('falls back to GMICLOUDSPEECH_API_KEY without a user key', () => {
    expect(
      initModelRuntimeWithUserPayload(ModelProvider.GmicloudSpeech, {})['_runtime'],
    ).toMatchObject({ apiKey: 'test-gmicloud-key', baseURL: 'https://console.gmicloud.ai' });
  });

  it('trims a trailing slash on a custom endpoint', () => {
    expect(
      initModelRuntimeWithUserPayload(ModelProvider.GmicloudSpeech, {
        apiKey: 'user-gmi-key',
        baseURL: 'https://proxy.example.com/',
      })['_runtime'].baseURL,
    ).toBe('https://proxy.example.com');
  });
});
