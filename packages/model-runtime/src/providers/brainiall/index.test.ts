// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeBrainiallAI, params } from './index';

const provider = ModelProvider.Brainiall;
const defaultBaseURL = 'https://api.brainiall.com/v1';

testProvider({
  Runtime: LobeBrainiallAI,
  chatDebugEnv: 'DEBUG_BRAINIALL_CHAT_COMPLETION',
  chatModel: 'claude-haiku-4-5',
  defaultBaseURL,
  provider,
  test: {
    skipAPICall: true,
  },
});

describe('LobeBrainiallAI - custom features', () => {
  let instance: InstanceType<typeof LobeBrainiallAI>;

  beforeEach(() => {
    instance = new LobeBrainiallAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params export', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.provider).toBe(ModelProvider.Brainiall);
      expect(params.baseURL).toBe('https://api.brainiall.com/v1');
      expect(params.debug).toBeDefined();
      expect(params.chatCompletion).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should have debug.chatCompletion function', () => {
      expect(typeof params.debug?.chatCompletion).toBe('function');
    });

    it('should return false when DEBUG_BRAINIALL_CHAT_COMPLETION is not set', () => {
      delete process.env.DEBUG_BRAINIALL_CHAT_COMPLETION;
      expect(params.debug?.chatCompletion()).toBe(false);
    });

    it('should return true when DEBUG_BRAINIALL_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_BRAINIALL_CHAT_COMPLETION = '1';
      expect(params.debug?.chatCompletion()).toBe(true);
      delete process.env.DEBUG_BRAINIALL_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should always set stream to true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-haiku-4-5',
        stream: false,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(true);
    });

    it('should preserve model in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-haiku-4-5',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('claude-haiku-4-5');
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'claude-haiku-4-5',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
      expect(calledPayload.max_tokens).toBe(100);
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
            capabilities: { function_calling: true, reasoning: true, vision: true },
            context_window: 200_000,
            description: 'Claude Opus 4.6',
            id: 'claude-opus-4-6',
            name: 'Claude Opus 4.6',
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.brainiall.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.brainiall.com/v1/models',
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

      const client = { apiKey: 'invalid-key', baseURL: 'https://api.brainiall.com/v1' };

      await expect(params.models!({ client: client as any })).rejects.toThrow(
        'Failed to fetch Brainiall models: 401 Unauthorized',
      );
    });

    it('should handle empty data', async () => {
      const mockModelsResponse = { data: [] };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.brainiall.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(models).toBeDefined();
    });

    it('should handle missing data field', async () => {
      const mockModelsResponse = {};

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.brainiall.com/v1' };
      const models = await params.models!({ client: client as any });

      expect(models).toBeDefined();
    });

    it('should strip trailing slashes from baseURL', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ data: [] }),
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.brainiall.com/v1///' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.brainiall.com/v1/models',
        expect.any(Object),
      );
    });

    it('should use default baseURL when client.baseURL is undefined', async () => {
      (global.fetch as any).mockResolvedValue({
        json: async () => ({ data: [] }),
        ok: true,
      });

      const client = { apiKey: 'test-key' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.brainiall.com/v1/models',
        expect.any(Object),
      );
    });

    it('should handle missing optional fields', async () => {
      const mockModelsResponse = {
        data: [
          {
            id: 'minimal-model',
          },
        ],
      };

      (global.fetch as any).mockResolvedValue({
        json: async () => mockModelsResponse,
        ok: true,
      });

      const client = { apiKey: 'test-key', baseURL: 'https://api.brainiall.com/v1' };
      await params.models!({ client: client as any });

      expect(global.fetch).toHaveBeenCalled();
    });
  });
});
