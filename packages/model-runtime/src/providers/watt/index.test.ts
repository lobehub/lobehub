// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeWattAI, params } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

testProvider({
  Runtime: LobeWattAI,
  provider: ModelProvider.Watt,
  defaultBaseURL: 'https://api.watt-cloud.com/v1',
  chatDebugEnv: 'DEBUG_WATT_CHAT_COMPLETION',
  chatModel: 'GLM-5.1',
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeWattAI - custom features', () => {
  let instance: InstanceType<typeof LobeWattAI>;

  beforeEach(() => {
    instance = new LobeWattAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params object', () => {
    it('should export params with correct baseURL', () => {
      expect(params.baseURL).toBe('https://api.watt-cloud.com/v1');
    });

    it('should have correct provider', () => {
      expect(params.provider).toBe(ModelProvider.Watt);
    });
  });

  describe('debug configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_WATT_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_WATT_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_WATT_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should map thinking enabled to chat_template_kwargs for toggleable models', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.1',
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.chat_template_kwargs).toEqual({ thinking: true });
    });

    it('should map thinking disabled to chat_template_kwargs for toggleable models', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.1',
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.chat_template_kwargs).toEqual({ thinking: false });
    });

    it('should not send chat_template_kwargs when thinking is unset', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.1',
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.chat_template_kwargs).toBeUndefined();
    });

    it('should not send chat_template_kwargs for models without a thinking off switch', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.3',
        thinking: { type: 'disabled' as const },
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.chat_template_kwargs).toBeUndefined();
    });

    it('should not send chat_template_kwargs for always-thinking models', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'Kimi-K2.7-Code',
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.chat_template_kwargs).toBeUndefined();
    });

    it('should strip the thinking field from the outbound payload', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.1',
        thinking: { type: 'enabled' as const },
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.thinking).toBeUndefined();
    });

    it('should preserve model parameter', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'DeepSeek-V4-Pro',
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.model).toBe('DeepSeek-V4-Pro');
    });

    it('should preserve messages parameter', () => {
      const messages = [
        { content: 'You are a helpful assistant', role: 'system' as const },
        { content: 'Hello', role: 'user' as const },
      ];
      const payload = {
        messages,
        model: 'GLM-5.1',
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.messages).toEqual(messages);
    });

    it('should preserve other payload properties', () => {
      const payload = {
        max_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' as const }],
        model: 'GLM-5.1',
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
      };

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBe(100);
      expect(result.top_p).toBe(0.9);
    });
  });

  describe('models', () => {
    it('should fetch and process models', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'GLM-5.1', object: 'model', owned_by: 'watt' },
              { id: 'DeepSeek-V4-Pro', object: 'model', owned_by: 'watt' },
              { id: 'Kimi-K3', object: 'model', owned_by: 'watt' },
            ],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toBeDefined();
      expect(models.length).toBe(3);
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should map model fields correctly', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'GLM-5.1', object: 'model', owned_by: 'watt' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('GLM-5.1');
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle missing data field', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({}),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle null data field', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: null,
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should handle API error gracefully', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should merge with known model data from model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'GLM-5.1', object: 'model', owned_by: 'watt' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should keep the Watt catalog contract, not another vendor's
      expect(model.id).toBe('GLM-5.1');
      expect(model.contextWindowTokens).toBe(202_752);
      expect(model.maxOutput).toBe(131_072);
    });

    it('should not let same-name upstream vendor cards override Watt limits', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'MiniMax-M3', object: 'model', owned_by: 'watt' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models.find((m) => m.id === 'MiniMax-M3');

      // MiniMax-M3 is 524,288 on Watt (MiniMax itself serves 1M)
      expect(model?.contextWindowTokens).toBe(524_288);
    });

    it('should handle models not in model-bank', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.watt-cloud.com/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'custom-model', object: 'model', owned_by: 'custom' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('custom-model');
    });
  });
});
