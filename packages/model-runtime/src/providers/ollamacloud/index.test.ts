// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOllamaCloudAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

// Custom feature tests
describe('LobeOllamaCloudAI - custom features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('params export', () => {
    it('should have correct structure', () => {
      expect(params).toHaveProperty('chatCompletion');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
      expect(params.chatCompletion).toHaveProperty('handlePayload');
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to 1', () => {
      process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
    });

    it('should disable debug when env is set to other values', () => {
      process.env.DEBUG_OLLAMA_CLOUD_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });
  });

  describe('handlePayload', () => {
    it('should preserve all payload properties', () => {
      const payload = {
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama3.2',
        stream: true,
        temperature: 0.7,
      };

      const result = params.chatCompletion.handlePayload(payload as any);

      expect(result.model).toBe('llama3.2');
      expect(result.messages).toEqual(payload.messages);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(100);
      expect(result.stream).toBe(true);
    });

    it('should handle minimal payload', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'llama3.2',
      };

      const result = params.chatCompletion.handlePayload(payload as any);

      expect(result.model).toBe('llama3.2');
      expect(result.messages).toEqual(payload.messages);
    });
  });

  describe('models function', () => {
    it('should fetch and process models when response has data array', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'llama3.2', object: 'model', owned_by: 'ollama' },
              { id: 'codellama', object: 'model', owned_by: 'ollama' },
            ],
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle response as direct array', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockResolvedValue([
            { id: 'llama3.2', object: 'model', owned_by: 'ollama' },
            { id: 'codellama', object: 'model', owned_by: 'ollama' },
          ]),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty data array', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
    it('should handle API error gracefully', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('API Error');

      expect(mockClient.models.list).toHaveBeenCalledTimes(1);
    });
    it('should handle invalid API key error', async () => {
      const mockClient = {
        apiKey: 'invalid',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('Invalid API Key')),
        },
      };

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('Invalid API Key');
    });

    it('should handle null response', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
    it('should handle response with non-array data', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://ollama.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: 'not-an-array',
          }),
        },
      };

      const result = await params.models({ client: mockClient as any });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });
  });

  describe('runtime instantiation', () => {
    it('should create instance with api key', () => {
      const runtime = new LobeOllamaCloudAI({ apiKey: 'test_api_key' });
      expect(runtime).toBeDefined();
      expect(runtime).toBeInstanceOf(LobeOllamaCloudAI);
    });

    it('should create instance with custom baseURL', () => {
      const runtime = new LobeOllamaCloudAI({
        apiKey: 'test_api_key',
        baseURL: 'https://custom.ollama.com/v1',
      });
      expect(runtime).toBeDefined();
      expect(runtime).toBeInstanceOf(LobeOllamaCloudAI);
    });

    it('should create instance with additional options', () => {
      const runtime = new LobeOllamaCloudAI({
        apiKey: 'test_api_key',
        baseURL: 'https://ollama.com/v1',
      });
      expect(runtime).toBeDefined();
    });
  });
});
