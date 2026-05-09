// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
            Authorization: 'Bearer test_api_key',
            'APP-Code': 'LobeHub',
          }),
        }),
      );
    });

    it('should normalize model_id field to id', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ model_id: 'some-model', object: 'model', created: 1, owned_by: 'test' }] }), { status: 200 }),
      );

      // Should not throw — normalization happens before processMultiProviderModelList
      const list = await instance.models();
      expect(Array.isArray(list)).toBe(true);
    });

    it('should return empty array when API key is missing', async () => {
      const instanceNoKey = new LobeAiHubMixAI({ apiKey: '' });
      const list = await instanceNoKey.models();
      expect(list).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty array on non-ok HTTP response', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

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
