// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { providerRuntimeMap } from '../../runtimeMap';
import { LobeFunASRAI, params } from './index';

describe('LobeFunASRAI', () => {
  it('uses the local OpenAI-compatible endpoint without requiring an API key', () => {
    expect(params).toMatchObject({
      apiKey: 'funasr-local',
      baseURL: 'http://localhost:8000/v1',
      provider: ModelProvider.FunASR,
    });

    const runtime = new LobeFunASRAI();
    expect(runtime.baseURL).toBe('http://localhost:8000/v1');
    expect(providerRuntimeMap.funasr).toBe(LobeFunASRAI);
  });

  it('does not forward a constructor-supplied OpenAI key to FunASR', () => {
    const runtime = new LobeFunASRAI({ apiKey: 'sk-openai-secret' });

    expect(runtime.client.apiKey).toBe('funasr-local');
  });
});
