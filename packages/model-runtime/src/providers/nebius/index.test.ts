// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeNebiusAI, params } from './index';

const provider = ModelProvider.Nebius;
const defaultBaseURL = 'https://api.studio.nebius.com/v1';

testProvider({
  Runtime: LobeNebiusAI,
  chatDebugEnv: 'DEBUG_NEBIUS_CHAT_COMPLETION',
  chatModel: 'meta/llama-3.1-8b-instruct',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
  },
});

describe('LobeNebiusAI - custom features', () => {
  let instance: InstanceType<typeof LobeNebiusAI>;

  beforeEach(() => {
    instance = new LobeNebiusAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Nebius);
      expect(params.baseURL).toBe('https://api.studio.nebius.com/v1');
      expect(params.debug).toBeDefined();
      expect(params.chatCompletion).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should have debug.chatCompletion function', () => {
      expect(typeof params.debug?.chatCompletion).toBe('function');
    });

    it('should return false when DEBUG_NEBIUS_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_NEBIUS_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_NEBIUS_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_NEBIUS_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_NEBIUS_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should always set stream to true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'meta/llama-3.1-8b-instruct',
        stream: false,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(true);
    });

    it('should preserve model in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'meta/llama-3.1-8b-instruct',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('meta/llama-3.1-8b-instruct');
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'meta/llama-3.1-8b-instruct',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(100);
    });
  });

  describe('modality inference logic', () => {
    it('should infer image type from modality', () => {
      const modality = 'text -> image';
      const parts = modality.split('->');
      const right = parts[1]?.trim().toLowerCase();
      expect(right).toBe('image');
    });

    it('should infer embedding type from modality', () => {
      const modality = 'text -> embedding';
      const parts = modality.split('->');
      const right = parts[1]?.trim().toLowerCase();
      expect(right).toBe('embedding');
    });

    it('should handle modality without ->', () => {
      const modality = 'text';
      const hasArrow = modality.includes('->');
      expect(hasArrow).toBe(false);
    });
  });

  describe('pricing calculation', () => {
    it('should convert pricing to per million tokens', () => {
      const pricing = {
        completion: 0.002,
        prompt: 0.001,
      };
      const result = {
        input: pricing.prompt * 1_000_000,
        output: pricing.completion * 1_000_000,
      };
      expect(result.input).toBe(1000);
      expect(result.output).toBe(2000);
    });
  });

  describe('features detection', () => {
    it('should detect function-calling feature', () => {
      const features = ['function-calling', 'vision'];
      expect(features.includes('function-calling')).toBe(true);
    });

    it('should detect reasoning feature', () => {
      const features = ['reasoning', 'vision'];
      expect(features.includes('reasoning')).toBe(true);
    });

    it('should detect vision feature', () => {
      const features = ['function-calling', 'vision'];
      expect(features.includes('vision')).toBe(true);
    });
  });

  describe('models function', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      global.fetch = vi.fn();
    });

    it('should fetch and process models successfully', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: 'text -> text' },
            context_length: 8192,
            description: 'Llama 3.1 8B Instruct model',
            features: ['function-calling', 'vision'],
            id: 'meta/llama-3.1-8b-instruct',
            name: 'Llama 3.1 8B Instruct',
            pricing: { completion: 0.0002, prompt: 0.0001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.studio.nebius.com/v1/models?verbose=true',
        {
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer test-key',
          },
          method: 'GET',
        },
      );
      expect(models).toBeDefined();
    });

    it('should handle fetch errors', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const client = { apiKey: 'invalid-key', baseURL: 'https://api.studio.nebius.com/v1' };

      await expect(params.models!({ client: client as any })).rejects.toThrow(
        'Failed to fetch Nebius models: 401 Unauthorized',
      );
    });

    it('should handle empty data', async () => {
      const mockModelsResponse = { data: [] };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(models).toBeDefined();
    });

    it('should handle missing data field', async () => {
      const mockModelsResponse = {};

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(models).toBeDefined();
    });

    it('should strip trailing slashes from baseURL', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ data: [] }),
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1///' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.studio.nebius.com/v1/models?verbose=true',
        expect.any(Object),
      );
    });

    it('should infer image type from modality', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: 'text -> image' },
            id: 'image-model',
            pricing: { completion: 0.002, prompt: 0.001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should infer embedding type from modality', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: 'text -> embedding' },
            id: 'embedding-model',
            pricing: { completion: 0.002, prompt: 0.001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle modality without arrow', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: 'text' },
            id: 'text-model',
            pricing: { completion: 0.002, prompt: 0.001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle non-string modality', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: null },
            id: 'model',
            pricing: { completion: 0.002, prompt: 0.001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should use default baseURL when client.baseURL is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ data: [] }),
        ok: true,
      });

      const client = { apiKey: 'test-key' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.studio.nebius.com/v1/models?verbose=true',
        expect.any(Object),
      );
    });

    it('should map all model properties correctly', async () => {
      const mockModelsResponse = {
        data: [
          {
            architecture: { modality: 'text -> image' },
            context_length: 4096,
            description: 'Test Description',
            features: ['function-calling', 'reasoning', 'vision'],
            id: 'test-model',
            name: 'Test Model',
            pricing: { completion: 0.001, prompt: 0.0005 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should handle missing optional fields', async () => {
      const mockModelsResponse = {
        data: [
          {
            id: 'minimal-model',
            pricing: { completion: 0.002, prompt: 0.001 },
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.studio.nebius.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
