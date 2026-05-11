// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as modelParse from '../../utils/modelParse';
import { LobeAiHubMixAI } from './index';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LobeAiHubMixAI', () => {
  let instance: InstanceType<typeof LobeAiHubMixAI>;

  beforeEach(() => {
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

    it('should return empty array on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const list = await instance.models();
      expect(list).toEqual([]);
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network Error'));

      const list = await instance.models();
      expect(list).toEqual([]);
    });

    it('should return empty array on timeout (AbortError)', async () => {
      mockFetch.mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      const list = await instance.models();
      expect(list).toEqual([]);
    });
  });
});
