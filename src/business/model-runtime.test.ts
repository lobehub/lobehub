import {
  lobehubRouterRuntimeOptions,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { afterEach, describe, expect, it } from 'vitest';

describe('business model runtime', () => {
  afterEach(() => {
    delete process.env.ACENSUS_AI_API_KEY;
    delete process.env.ACENSUS_AI_API_TYPE;
    delete process.env.ACENSUS_AI_BASE_URL;
    delete process.env.ACENSUS_AI_MODELS;
    delete process.env.ACENSUS_AI_DEFAULT_MODEL;
    delete process.env.ACENSUS_AI_MODEL_MAPPING;
  });

  it('should route the official provider through Acensus AI env config', async () => {
    process.env.ACENSUS_AI_API_KEY = 'acensus-key';
    process.env.ACENSUS_AI_API_TYPE = 'openai';
    process.env.ACENSUS_AI_BASE_URL = 'https://ai.acensus.test/v1';
    process.env.ACENSUS_AI_MODELS = 'gpt-4.1,gpt-4.1-mini';

    const routers = await lobehubRouterRuntimeOptions.routers({}, { model: 'gpt-4.1' });

    expect(lobehubRouterRuntimeOptions.id).toBe('lobehub');
    expect(routers).toEqual([
      {
        apiType: 'openai',
        models: ['gpt-4.1', 'gpt-4.1-mini'],
        options: {
          apiKey: 'acensus-key',
          baseURL: 'https://ai.acensus.test/v1',
        },
      },
    ]);
  });

  it('should use the Acensus default model when the model list is not configured', async () => {
    process.env.ACENSUS_AI_API_KEY = 'acensus-key';
    process.env.ACENSUS_AI_DEFAULT_MODEL = 'gpt-4.1-mini';

    const routers = await lobehubRouterRuntimeOptions.routers({}, { model: 'gpt-4.1' });

    expect(routers[0]?.models).toEqual(['gpt-4.1-mini']);
    expect(routers[0]?.options.baseURL).toBe('https://api.cometapi.com/v1');
  });

  it('should resolve compact Acensus model mapping', async () => {
    process.env.ACENSUS_AI_MODEL_MAPPING =
      'gpt-4.1=internal-gpt-4.1,gpt-4.1-mini=internal-gpt-4.1-mini';

    await expect(resolveBusinessModelMapping('lobehub', 'gpt-4.1-mini')).resolves.toEqual({
      requestedModelId: 'gpt-4.1-mini',
      resolvedModelId: 'internal-gpt-4.1-mini',
    });
  });
});
