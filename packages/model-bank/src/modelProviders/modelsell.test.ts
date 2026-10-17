import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_PROVIDER_LIST } from './index';
import Modelsell from './modelsell';

describe('Modelsell provider card', () => {
  it('registers the OpenAI-compatible provider with dynamic model discovery', () => {
    expect(DEFAULT_MODEL_PROVIDER_LIST).toContain(Modelsell);
    expect(Modelsell).toMatchObject({
      apiKeyUrl: 'https://modelsell.com/console/token',
      chatModels: [],
      id: 'modelsell',
      modelList: { showModelFetcher: true },
      modelsUrl: 'https://modelsell.com/v1/models',
      settings: {
        proxyUrl: { placeholder: 'https://modelsell.com/v1' },
        sdkType: 'openai',
        showModelFetcher: true,
      },
      url: 'https://modelsell.com',
    });
  });
});
