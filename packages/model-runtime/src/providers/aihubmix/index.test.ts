// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as modelParse from '../../utils/modelParse';
import { LobeAiHubMixAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

type RouterForTest = {
  apiType: string;
  models?: string[];
};

const resolveRouters = (model?: string) =>
  (typeof params.routers === 'function'
    ? params.routers({ apiKey: 'test' }, { model })
    : params.routers) as RouterForTest[];

describe('LobeAiHubMixAI', () => {
  let instance: InstanceType<typeof LobeAiHubMixAI>;

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeAiHubMixAI({ apiKey: 'test_api_key' });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe('constructor', () => {
    it('should initialize with correct provider', () => {
      expect(instance).toBeDefined();
    });

    it('should set APP-Code header', () => {
      // The RouterRuntime-based providers have different structure
      // We just verify the instance is created correctly
      expect(instance).toBeInstanceOf(LobeAiHubMixAI);
    });
  });

  describe('routers', () => {
    it('should route the whole DeepSeek family to the deepseek runtime', () => {
      // The generic openai fallback sends response_format json_schema for
      // structured output, which DeepSeek upstreams reject — the deepseek
      // runtime simulates it via tool calling instead.
      const routers = resolveRouters();
      const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

      expect(deepseekRouter?.models).toEqual(
        expect.arrayContaining([
          'deepseek-chat',
          'deepseek-reasoner',
          'deepseek-v4-flash',
          'deepseek-v4-pro',
        ]),
      );
    });

    it('should match gateway-specific DeepSeek ids missing from the static model list', () => {
      const routers = resolveRouters('deepseek-v4-flash-free');
      const deepseekRouter = routers.find((router) => router.apiType === 'deepseek');

      expect(deepseekRouter?.models).toContain('deepseek-v4-flash-free');
    });

    it('should thread a custom baseURL through all routes, defaulting to aihubmix.com', () => {
      const custom = (params.routers as any)(
        { apiKey: 'test', baseURL: 'https://my-aihubmix-mirror.com' },
        {},
      );
      const baseOf = (apiType: string) =>
        custom.find((r: any) => r.apiType === apiType).options.baseURL;
      expect(baseOf('anthropic')).toBe('https://my-aihubmix-mirror.com');
      expect(baseOf('google')).toBe('https://my-aihubmix-mirror.com/gemini');
      expect(baseOf('openai')).toBe('https://my-aihubmix-mirror.com/v1');

      // A custom endpoint that already includes the API version is normalized,
      // so the route suffixes are not doubled (…/v1/v1, …/v1/gemini).
      const versioned = (params.routers as any)(
        { apiKey: 'test', baseURL: 'https://my-aihubmix-mirror.com/v1' },
        {},
      );
      const vBaseOf = (apiType: string) =>
        versioned.find((r: any) => r.apiType === apiType).options.baseURL;
      expect(vBaseOf('anthropic')).toBe('https://my-aihubmix-mirror.com');
      expect(vBaseOf('google')).toBe('https://my-aihubmix-mirror.com/gemini');
      expect(vBaseOf('openai')).toBe('https://my-aihubmix-mirror.com/v1');

      // Falls back to the default gateway when no custom baseURL is set
      const def = (params.routers as any)({ apiKey: 'test' }, {});
      expect(def.find((r: any) => r.apiType === 'anthropic').options.baseURL).toBe(
        'https://aihubmix.com',
      );
    });
  });

  describe('chat', () => {
    it('should support chat method', async () => {
      vi.spyOn(instance as any, 'runWithFallback').mockResolvedValue(new Response());

      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'gpt-4',
        temperature: 0.7,
      };

      const result = await instance.chat(payload);
      expect(result).toBeDefined();
    });
  });

  describe('models', () => {
    const mockModels = [
      { id: 'gpt-4o', object: 'model', created: 1, owned_by: 'openai' },
      { model_id: 'claude-3-5-sonnet', object: 'model', created: 1, owned_by: 'anthropic' },
    ];

    it('should fetch from full endpoint with correct headers', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockModels }), { status: 200 }),
      );

      await instance.models();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://aihubmix.com/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test_api_key',
            'APP-Code': 'LobeHub',
          }),
        }),
      );
    });

    it('should fetch the model list from a custom base URL when configured', async () => {
      const customInstance = new LobeAiHubMixAI({
        apiKey: 'test_api_key',
        baseURL: 'https://my-aihubmix-mirror.com',
      });
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: mockModels }), { status: 200 }),
      );

      await customInstance.models();

      // The /api/v1/models catalog endpoint follows the configured gateway,
      // derived from the client baseURL (trailing /v1 stripped), not the default.
      expect(mockFetch).toHaveBeenCalledWith(
        'https://my-aihubmix-mirror.com/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test_api_key',
            'APP-Code': 'LobeHub',
          }),
        }),
      );
    });

    it('should normalize model_id field to id', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ model_id: 'some-model', object: 'model', created: 1, owned_by: 'test' }],
          }),
          { status: 200 },
        ),
      );

      // Normalization must set id so processMultiProviderModelList receives a valid model
      const list = (await instance.models()) as { id: string }[];
      expect(list.some((m) => m.id === 'some-model')).toBe(true);
    });

    it('should map AiHubMix API fields to LobeHub model card fields', async () => {
      const spy = vi.spyOn(modelParse, 'processMultiProviderModelList').mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                model_id: 'test-llm',
                desc: 'A test LLM',
                types: 'llm',
                features: 'tools,function_calling,thinking,web',
                input_modalities: 'text,image',
                context_length: 128_000,
                max_output: 8192,
                pricing: { input: 1, output: 3, cache_read: 0.25, cache_write: 0.5 },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      await instance.models();

      expect(spy).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            contextWindowTokens: 128_000,
            description: 'A test LLM',
            functionCall: true,
            id: 'test-llm',
            maxOutput: 8192,
            pricing: { cachedInput: 0.25, input: 1, output: 3, writeCacheInput: 0.5 },
            reasoning: true,
            search: true,
            type: 'chat',
            vision: true,
          }),
        ]),
        'aihubmix',
      );
    });

    it('should filter out rerank models so they do not appear as chat models', async () => {
      const spy = vi.spyOn(modelParse, 'processMultiProviderModelList').mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { model_id: 'cohere-rerank-v4.0', types: 'rerank' },
              { model_id: 'qwen3-reranker-8b', types: 'reranking' },
              { model_id: 'gpt-4o', types: 'llm' },
            ],
          }),
          { status: 200 },
        ),
      );

      await instance.models();

      const passedModels = spy.mock.calls.at(-1)![0] as { id: string }[];
      expect(passedModels.find((m) => m.id === 'cohere-rerank-v4.0')).toBeUndefined();
      expect(passedModels.find((m) => m.id === 'qwen3-reranker-8b')).toBeUndefined();
      expect(passedModels.find((m) => m.id === 'gpt-4o')).toBeDefined();
    });

    it('should throw on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(instance.models()).rejects.toThrow('HTTP 401: Unauthorized');
    });

    it('should throw on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network Error'));

      await expect(instance.models()).rejects.toThrow('Network Error');
    });

    it('should throw on timeout (AbortError)', async () => {
      mockFetch.mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      await expect(instance.models()).rejects.toThrow('The operation was aborted');
    });
  });
});
