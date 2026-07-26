// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetModelsDevCacheForTests } from '../utils/modelsDev';
import { params } from './index';

const resolveRouters = async (model?: string) =>
  (await params.routers({ apiKey: 'test' }, { model })) as Array<{
    apiType: string;
    models?: string[];
    options: { baseURL?: string; sdkType?: string };
  }>;

beforeEach(() => {
  __resetModelsDevCacheForTests();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in test')));
});

afterEach(() => {
  __resetModelsDevCacheForTests();
  vi.unstubAllGlobals();
});

describe('OpenCodeZen routers', () => {
  it('should route models.dev models by AI SDK package', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          opencode: {
            models: {
              'gateway-anthropic-model': {
                id: 'gateway-anthropic-model',
                provider: { npm: '@ai-sdk/anthropic' },
              },
              'gateway-google-model': {
                id: 'gateway-google-model',
                provider: { npm: '@ai-sdk/google' },
              },
              'gateway-response-model': {
                id: 'gateway-response-model',
                provider: { npm: '@ai-sdk/openai' },
              },
            },
          },
        }),
        ok: true,
      }),
    );

    const routers = await resolveRouters('gateway-anthropic-model');
    const anthropicRouter = routers.find((router) => router.apiType === 'anthropic');
    const googleRouter = routers.find((router) => router.apiType === 'google');
    const responseRouter = routers.find(
      (router) => router.apiType === 'openai' && router.models?.includes('gateway-response-model'),
    );

    expect(anthropicRouter?.models).toContain('gateway-anthropic-model');
    expect(googleRouter?.models).toContain('gateway-google-model');
    expect(responseRouter?.models).toContain('gateway-response-model');
  });

  it('should route DeepSeek-family models to the deepseek runtime', async () => {
    // The generic openai fallback sends response_format json_schema for
    // structured output, which DeepSeek upstreams reject — the deepseek
    // runtime simulates it via tool calling instead.
    const routers = await resolveRouters('deepseek-v4-flash');
    const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

    expect(deepseekRouter?.models).toContain('deepseek-v4-flash');
    expect(deepseekRouter?.options.sdkType).toBe('openai');
  });

  it('should match gateway-specific DeepSeek ids missing from the static model list', async () => {
    const routers = await resolveRouters('deepseek-v4-flash-free');
    const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

    expect(deepseekRouter?.models).toContain('deepseek-v4-flash-free');
  });

  it('should keep the openai catch-all as the last router', async () => {
    const routers = await resolveRouters('some-unknown-model');

    expect(routers.at(-1)?.apiType).toBe('openai');
    expect(routers.at(-1)?.models).toBeUndefined();
  });
});

describe('OpenCodeZen models', () => {
  it('enriches API models with models.dev reasoning controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          opencode: {
            models: {
              'test-reasoning-model': {
                id: 'test-reasoning-model',
                reasoning: true,
                reasoning_options: [{ type: 'toggle' }],
              },
            },
          },
        }),
        ok: true,
      }),
    );

    const models = await params.models({
      client: {
        models: { list: vi.fn().mockResolvedValue({ data: [{ id: 'test-reasoning-model' }] }) },
      } as any,
    });

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'test-reasoning-model',
          reasoning: true,
          settings: expect.objectContaining({ extendParams: ['enableReasoning'] }),
        }),
      ]),
    );
  });
});
