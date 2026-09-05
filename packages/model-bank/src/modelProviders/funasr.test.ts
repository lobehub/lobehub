import { describe, expect, it } from 'vitest';

import FunASRProvider from './funasr';
import { DEFAULT_MODEL_PROVIDER_LIST } from './index';

describe('FunASR provider card', () => {
  it('registers a keyless OpenAI-compatible local endpoint', () => {
    expect(FunASRProvider).toMatchObject({
      chatModels: [],
      id: 'funasr',
      name: 'FunASR',
      settings: {
        disableBrowserRequest: true,
        proxyUrl: { placeholder: 'http://localhost:8000/v1' },
        sdkType: 'openai',
        showApiKey: false,
        showChecker: false,
      },
      url: 'https://www.funasr.com',
    });
  });

  it('is discoverable in the builtin provider list', () => {
    expect(DEFAULT_MODEL_PROVIDER_LIST).toContain(FunASRProvider);
  });
});
