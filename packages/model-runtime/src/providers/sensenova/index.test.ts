// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { convertSenseNovaMessage } from '../../core/contextBuilders/sensenova';
import { testProvider } from '../../providerTestUtils';
import { LobeSenseNovaAI, params } from './index';

const provider = ModelProvider.SenseNova;
const defaultBaseURL = 'https://api.sensenova.cn/compatible-mode/v1';

// Basic provider tests
testProvider({
  Runtime: LobeSenseNovaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_SENSENOVA_CHAT_COMPLETION',
  chatModel: 'deepseek-r1',
  test: {
    skipAPICall: true,
  },
});

// Custom feature tests
describe('LobeSenseNovaAI - custom features', () => {
  let instance: InstanceType<typeof LobeSenseNovaAI>;

  beforeEach(() => {
    instance = new LobeSenseNovaAI({ apiKey: 'test_api_key' });
    vi.clearAllMocks();
  });

  describe('params object', () => {
    it('should export params with correct structure', () => {
      expect(params).toBeDefined();
      expect(params.baseURL).toBe('https://api.sensenova.cn/compatible-mode/v1');
      expect(params.provider).toBe('sensenova');
      expect(params.chatCompletion).toBeDefined();
      expect(params.debug).toBeDefined();
      expect(params.models).toBeDefined();
    });

    it('should have handlePayload function in chatCompletion', () => {
      expect(typeof params.chatCompletion.handlePayload).toBe('function');
    });

    it('should have chatCompletion debug function', () => {
      expect(typeof params.debug.chatCompletion).toBe('function');
    });

    it('should have models function', () => {
      expect(typeof params.models).toBe('function');
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_SENSENOVA_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set to 1', () => {
      process.env.DEBUG_SENSENOVA_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_SENSENOVA_CHAT_COMPLETION;
    });

    it('should disable debug when env is set to other values', () => {
      process.env.DEBUG_SENSENOVA_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_SENSENOVA_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    const createMockPayload = (overrides = {}) => ({
      frequency_penalty: 1.5,
      max_tokens: 100,
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'SenseChat-5',
      temperature: 0.7,
      top_p: 0.9,
      ...overrides,
    });

    it('should handle basic payload transformation', () => {
      const payload = createMockPayload();
      const result = params.chatCompletion.handlePayload(payload as any);

      expect(result).toMatchObject({
        frequency_penalty: 1.5,
        max_new_tokens: 100,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        stream: true,
        temperature: 0.7,
        top_p: 0.9,
      });
    });

    describe('frequency_penalty handling', () => {
      it('should keep valid frequency_penalty in range (0, 2]', () => {
        const payload = createMockPayload({ frequency_penalty: 1.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBe(1.5);
      });

      it('should remove frequency_penalty when it is 0', () => {
        const payload = createMockPayload({ frequency_penalty: 0 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBeUndefined();
      });

      it('should remove frequency_penalty when it is negative', () => {
        const payload = createMockPayload({ frequency_penalty: -0.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBeUndefined();
      });

      it('should remove frequency_penalty when it exceeds 2', () => {
        const payload = createMockPayload({ frequency_penalty: 2.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBeUndefined();
      });

      it('should keep frequency_penalty at boundary value 2', () => {
        const payload = createMockPayload({ frequency_penalty: 2 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBe(2);
      });

      it('should keep frequency_penalty at minimal valid value', () => {
        const payload = createMockPayload({ frequency_penalty: 0.001 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBe(0.001);
      });

      it('should remove frequency_penalty when undefined', () => {
        const payload = createMockPayload({ frequency_penalty: undefined });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.frequency_penalty).toBeUndefined();
      });
    });

    describe('max_tokens handling', () => {
      it('should convert max_tokens to max_new_tokens', () => {
        const payload = createMockPayload({ max_tokens: 100 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.max_new_tokens).toBe(100);
        expect(result.max_tokens).toBeUndefined();
      });

      it('should remove max_new_tokens when max_tokens is 0', () => {
        const payload = createMockPayload({ max_tokens: 0 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.max_new_tokens).toBeUndefined();
      });

      it('should remove max_new_tokens when max_tokens is negative', () => {
        const payload = createMockPayload({ max_tokens: -10 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.max_new_tokens).toBeUndefined();
      });

      it('should remove max_new_tokens when max_tokens is undefined', () => {
        const payload = createMockPayload({ max_tokens: undefined });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.max_new_tokens).toBeUndefined();
      });

      it('should handle large max_tokens values', () => {
        const payload = createMockPayload({ max_tokens: 100000 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.max_new_tokens).toBe(100000);
      });
    });

    describe('temperature handling', () => {
      it('should keep valid temperature in range (0, 2]', () => {
        const payload = createMockPayload({ temperature: 0.7 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBe(0.7);
      });

      it('should remove temperature when it is 0', () => {
        const payload = createMockPayload({ temperature: 0 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBeUndefined();
      });

      it('should remove temperature when it is negative', () => {
        const payload = createMockPayload({ temperature: -0.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBeUndefined();
      });

      it('should remove temperature when it exceeds 2', () => {
        const payload = createMockPayload({ temperature: 2.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBeUndefined();
      });

      it('should keep temperature at boundary value 2', () => {
        const payload = createMockPayload({ temperature: 2 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBe(2);
      });

      it('should keep temperature at minimal valid value', () => {
        const payload = createMockPayload({ temperature: 0.001 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBe(0.001);
      });

      it('should remove temperature when undefined', () => {
        const payload = createMockPayload({ temperature: undefined });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.temperature).toBeUndefined();
      });
    });

    describe('top_p handling', () => {
      it('should keep valid top_p in range (0, 1)', () => {
        const payload = createMockPayload({ top_p: 0.9 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBe(0.9);
      });

      it('should remove top_p when it is 0', () => {
        const payload = createMockPayload({ top_p: 0 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBeUndefined();
      });

      it('should remove top_p when it is 1', () => {
        const payload = createMockPayload({ top_p: 1 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBeUndefined();
      });

      it('should remove top_p when it is negative', () => {
        const payload = createMockPayload({ top_p: -0.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBeUndefined();
      });

      it('should remove top_p when it exceeds 1', () => {
        const payload = createMockPayload({ top_p: 1.5 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBeUndefined();
      });

      it('should keep top_p at minimal valid value', () => {
        const payload = createMockPayload({ top_p: 0.001 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBe(0.001);
      });

      it('should keep top_p at maximal valid value', () => {
        const payload = createMockPayload({ top_p: 0.999 });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBe(0.999);
      });

      it('should remove top_p when undefined', () => {
        const payload = createMockPayload({ top_p: undefined });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.top_p).toBeUndefined();
      });
    });

    describe('thinking parameter handling', () => {
      it('should enable thinking for V6-5 models when type is enabled', () => {
        const payload = createMockPayload({
          model: 'SenseNova-V6-5-Plus',
          thinking: { type: 'enabled' },
        });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.thinking).toEqual({ enabled: true });
      });

      it('should disable thinking for V6-5 models when type is not enabled', () => {
        const payload = createMockPayload({
          model: 'SenseNova-V6-5-Plus',
          thinking: { type: 'disabled' },
        });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.thinking).toEqual({ enabled: false });
      });

      it('should disable thinking for non-V6-5 models even when type is enabled', () => {
        const payload = createMockPayload({
          model: 'SenseChat-5',
          thinking: { type: 'enabled' },
        });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.thinking).toEqual({ enabled: false });
      });

      it('should handle thinking for V6-5 model with case sensitivity', () => {
        const payload = createMockPayload({
          model: 'sensenova-v6-5-plus',
          thinking: { type: 'enabled' },
        });
        const result = params.chatCompletion.handlePayload(payload as any);
        // The code uses includes('-V6-5-') which is case-sensitive, so lowercase v6-5 won't match
        expect(result.thinking).toEqual({ enabled: false });
      });

      it('should remove thinking when not provided', () => {
        const payload = createMockPayload({ thinking: undefined });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.thinking).toBeUndefined();
      });

      it('should handle thinking for model without -V6-5-', () => {
        const payload = createMockPayload({
          model: 'SenseNova-V6',
          thinking: { type: 'enabled' },
        });
        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.thinking).toEqual({ enabled: false });
      });
    });

    describe('Vision model message conversion', () => {
      it('should convert messages for SenseNova-V6 models', () => {
        const payload = createMockPayload({
          messages: [
            {
              content: [
                { text: 'Hello', type: 'text' },
                {
                  image_url: { url: 'https://example.com/image.jpg' },
                  type: 'image_url',
                },
              ],
              role: 'user',
            },
          ],
          model: 'SenseNova-V6',
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.messages[0].content).toEqual([
          { text: 'Hello', type: 'text' },
          { image_url: 'https://example.com/image.jpg', type: 'image_url' },
        ]);
      });

      it('should convert messages for SenseChat-Vision models', () => {
        const payload = createMockPayload({
          messages: [
            {
              content: [
                { text: 'Describe this image', type: 'text' },
                {
                  image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ...' },
                  type: 'image_url',
                },
              ],
              role: 'user',
            },
          ],
          model: 'SenseChat-Vision',
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.messages[0].content).toEqual([
          { text: 'Describe this image', type: 'text' },
          { image_base64: '/9j/4AAQ...', type: 'image_base64' },
        ]);
      });

      it('should not convert messages for non-vision models', () => {
        const originalContent = [
          { text: 'Hello', type: 'text' },
          {
            image_url: { url: 'https://example.com/image.jpg' },
            type: 'image_url',
          },
        ];
        const payload = createMockPayload({
          messages: [{ content: originalContent, role: 'user' }],
          model: 'SenseChat-5',
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.messages[0].content).toEqual(originalContent);
      });

      it('should not convert messages for assistant role', () => {
        const originalContent = [
          { text: 'Hello', type: 'text' },
          {
            image_url: { url: 'https://example.com/image.jpg' },
            type: 'image_url',
          },
        ];
        const payload = createMockPayload({
          messages: [{ content: originalContent, role: 'assistant' }],
          model: 'SenseNova-V6',
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.messages[0].content).toEqual(originalContent);
      });

      it('should handle string content without conversion', () => {
        const payload = createMockPayload({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'SenseNova-V6',
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        // convertSenseNovaMessage converts string to text array format
        expect(result.messages[0].content).toEqual([{ text: 'Hello', type: 'text' }]);
      });

      it('should handle messages when model is undefined', () => {
        const originalContent = [{ text: 'Hello', type: 'text' }];
        const payload = createMockPayload({
          messages: [{ content: originalContent, role: 'user' }],
          model: undefined,
        });

        const result = params.chatCompletion.handlePayload(payload as any);
        expect(result.messages[0].content).toEqual(originalContent);
      });
    });

    it('should always set stream to true', () => {
      const payload = createMockPayload({ stream: false });
      const result = params.chatCompletion.handlePayload(payload as any);
      expect(result.stream).toBe(true);
    });

    it('should preserve other payload properties', () => {
      const payload = createMockPayload({
        custom_property: 'custom_value',
        presence_penalty: 0.5,
      });
      const result = params.chatCompletion.handlePayload(payload as any);
      expect(result.custom_property).toBe('custom_value');
      expect(result.presence_penalty).toBe(0.5);
    });
  });

  describe('models function', () => {
    it('should fetch and process model list', async () => {
      const mockClient = {
        apiKey: 'test',
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'SenseChat-5' },
              { id: 'SenseNova-V6' },
              { id: 'deepseek-r1' },
              { id: 'model-1202' },
            ],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });

      expect(mockClient.baseURL).toBe('https://api.sensenova.cn/v1/llm');
      expect(mockClient.models.list).toHaveBeenCalled();
      expect(models).toHaveLength(4);
    });

    it('should detect function call capability by keyword 1202', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-1202' }, { id: 'normal-model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const functionCallModel = models.find((m) => m.id === 'model-1202');
      const normalModel = models.find((m) => m.id === 'normal-model');

      expect(functionCallModel?.functionCall).toBe(true);
      expect(normalModel?.functionCall).toBe(false);
    });

    it('should detect vision capability by keyword vision', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-vision' }, { id: 'normal-model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const visionModel = models.find((m) => m.id === 'model-vision');
      const normalModel = models.find((m) => m.id === 'normal-model');

      expect(visionModel?.vision).toBe(true);
      expect(normalModel?.vision).toBe(false);
    });

    it('should detect vision capability by keyword sensenova-v6', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'sensenova-v6' }, { id: 'sensenova-v5' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const v6Model = models.find((m) => m.id === 'sensenova-v6');
      const v5Model = models.find((m) => m.id === 'sensenova-v5');

      expect(v6Model?.vision).toBe(true);
      expect(v5Model?.vision).toBe(false);
    });

    it('should detect reasoning capability by keyword deepseek-r1', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'deepseek-r1' }, { id: 'deepseek' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const reasoningModel = models.find((m) => m.id === 'deepseek-r1');
      const normalModel = models.find((m) => m.id === 'deepseek');

      expect(reasoningModel?.reasoning).toBe(true);
      expect(normalModel?.reasoning).toBe(false);
    });

    it('should detect reasoning capability by keyword reasoner', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-reasoner' }, { id: 'model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const reasonerModel = models.find((m) => m.id === 'model-reasoner');
      const normalModel = models.find((m) => m.id === 'model');

      expect(reasonerModel?.reasoning).toBe(true);
      expect(normalModel?.reasoning).toBe(false);
    });

    it('should merge with LOBE_DEFAULT_MODEL_LIST when model is known', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'SenseChat-5' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      // Should have properties from LOBE_DEFAULT_MODEL_LIST
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('enabled');
    });

    it('should use default values for unknown models', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'unknown-model-xyz' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('unknown-model-xyz');
      expect(model.enabled).toBe(false);
      expect(model.contextWindowTokens).toBeUndefined();
      expect(model.displayName).toBeUndefined();
    });

    it('should handle case-insensitive model matching', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'SENSECHAT-5' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('SENSECHAT-5');
    });

    it('should merge abilities from known model', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'test-model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      // Should have all ability flags (even if false)
      expect(model).toHaveProperty('functionCall');
      expect(model).toHaveProperty('vision');
      expect(model).toHaveProperty('reasoning');
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should handle empty model list', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      expect(models).toEqual([]);
    });

    it('should change client baseURL to models endpoint', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'test-model' }],
          }),
        },
      };

      await params.models({ client: mockClient as any });
      expect(mockClient.baseURL).toBe('https://api.sensenova.cn/v1/llm');
    });

    it('should detect multiple ability keywords in one model', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'model-1202-vision-reasoner' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(true); // has 1202
      expect(model.vision).toBe(true); // has vision
      expect(model.reasoning).toBe(true); // has reasoner
    });

    it('should prioritize keyword detection over known model abilities', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'custom-1202-model' }],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      // Should detect functionCall from keyword even if not in LOBE_DEFAULT_MODEL_LIST
      expect(model.functionCall).toBe(true);
    });

    it('should use OR logic for combining keyword and known model abilities', async () => {
      const mockClient = {
        baseURL: 'https://api.sensenova.cn/compatible-mode/v1',
        models: {
          list: vi.fn().mockResolvedValue({
            data: [
              { id: 'SenseChat-5' }, // Known model, no special keywords
            ],
          }),
        },
      };

      const models = await params.models({ client: mockClient as any });
      const model = models[0];

      // Should get abilities from LOBE_DEFAULT_MODEL_LIST for known models
      expect(model.id).toBe('SenseChat-5');
      expect(model).toHaveProperty('functionCall');
      expect(model).toHaveProperty('vision');
      expect(model).toHaveProperty('reasoning');
    });
  });
});

describe('LobeSenseNovaAI - chat integration', () => {
  let instance: InstanceType<typeof LobeSenseNovaAI>;

  beforeEach(() => {
    instance = new LobeSenseNovaAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('chat method payload handling', () => {
    it('should call handlePayload correctly for basic chat', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        temperature: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'SenseChat-5',
          stream: true,
          temperature: 0.7,
        }),
        expect.anything(),
      );
    });

    it('should convert vision model messages', async () => {
      await instance.chat({
        messages: [
          {
            content: JSON.stringify([
              { text: 'Describe', type: 'text' },
              {
                image_url: { url: 'https://example.com/image.jpg' },
                type: 'image_url',
              },
            ]),
            role: 'user',
          },
        ],
        model: 'SenseNova-V6',
        temperature: 0.7,
      });

      // The payload transformation happens inside handlePayload
      expect(instance['client'].chat.completions.create).toHaveBeenCalled();
    });

    it('should handle temperature normalization in chat', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        temperature: 1.5,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 1.5,
        }),
        expect.anything(),
      );
    });

    it('should handle max_tokens conversion to max_new_tokens', async () => {
      await instance.chat({
        max_tokens: 500,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        temperature: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_new_tokens: 500,
        }),
        expect.anything(),
      );
    });

    it('should handle thinking parameter for V6-5 model', async () => {
      await instance.chat({
        messages: [{ content: 'Solve this', role: 'user' }],
        model: 'SenseNova-V6-5-Plus',
        temperature: 0.7,
        thinking: { type: 'enabled' },
      } as any);

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { enabled: true },
        }),
        expect.anything(),
      );
    });

    it('should handle frequency_penalty parameter', async () => {
      await instance.chat({
        frequency_penalty: 1.2,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        temperature: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          frequency_penalty: 1.2,
        }),
        expect.anything(),
      );
    });

    it('should handle top_p parameter', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'SenseChat-5',
        temperature: 0.7,
        top_p: 0.95,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          top_p: 0.95,
        }),
        expect.anything(),
      );
    });
  });
});

describe('convertSenseNovaMessage', () => {
  describe('string content', () => {
    it('should convert string content to text array', () => {
      const result = convertSenseNovaMessage('Hello world');
      expect(result).toEqual([{ text: 'Hello world', type: 'text' }]);
    });

    it('should convert empty string to text array', () => {
      const result = convertSenseNovaMessage('');
      expect(result).toEqual([{ text: '', type: 'text' }]);
    });
  });

  describe('non-array content', () => {
    it('should return empty array for null', () => {
      const result = convertSenseNovaMessage(null);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined', () => {
      const result = convertSenseNovaMessage(undefined);
      expect(result).toEqual([]);
    });

    it('should return empty array for object', () => {
      const result = convertSenseNovaMessage({ key: 'value' });
      expect(result).toEqual([]);
    });

    it('should return empty array for number', () => {
      const result = convertSenseNovaMessage(123);
      expect(result).toEqual([]);
    });
  });

  describe('text type content', () => {
    it('should keep text type content as is', () => {
      const content = [{ text: 'Hello', type: 'text' }];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([{ text: 'Hello', type: 'text' }]);
    });

    it('should handle multiple text items', () => {
      const content = [
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' },
      ]);
    });
  });

  describe('image_url type content', () => {
    it('should convert HTTP image_url to image_url type', () => {
      const content = [
        {
          image_url: { url: 'https://example.com/image.jpg' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([{ image_url: 'https://example.com/image.jpg', type: 'image_url' }]);
    });

    it('should convert base64 JPEG to image_base64 type', () => {
      const content = [
        {
          image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([{ image_base64: '/9j/4AAQSkZJRg==', type: 'image_base64' }]);
    });

    it('should convert base64 PNG to image_base64 type', () => {
      const content = [
        {
          image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([{ image_base64: 'iVBORw0KGgo=', type: 'image_base64' }]);
    });

    it('should filter out image_url with missing url', () => {
      const content = [
        {
          image_url: {},
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([]);
    });

    it('should filter out image_url with null url', () => {
      const content = [
        {
          image_url: { url: null },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([]);
    });

    it('should filter out image_url with non-string url', () => {
      const content = [
        {
          image_url: { url: 123 },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([]);
    });

    it('should filter out image_url without image_url property', () => {
      const content = [
        {
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([]);
    });
  });

  describe('mixed content', () => {
    it('should handle mixed text and image_url', () => {
      const content = [
        { text: 'Describe this image:', type: 'text' },
        {
          image_url: { url: 'https://example.com/image.jpg' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Describe this image:', type: 'text' },
        { image_url: 'https://example.com/image.jpg', type: 'image_url' },
      ]);
    });

    it('should handle mixed text and base64 image', () => {
      const content = [
        { text: 'Look at this:', type: 'text' },
        {
          image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Look at this:', type: 'text' },
        { image_base64: '/9j/4AAQ', type: 'image_base64' },
      ]);
    });
  });

  describe('edge cases', () => {
    it('should filter out null items', () => {
      const content = [{ text: 'Hello', type: 'text' }, null, { text: 'World', type: 'text' }];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' },
      ]);
    });

    it('should filter out undefined items', () => {
      const content = [{ text: 'Hello', type: 'text' }, undefined, { text: 'World', type: 'text' }];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' },
      ]);
    });

    it('should filter out unknown type items', () => {
      const content = [
        { text: 'Hello', type: 'text' },
        { data: 'unknown', type: 'unknown' },
        { text: 'World', type: 'text' },
      ];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([
        { text: 'Hello', type: 'text' },
        { text: 'World', type: 'text' },
      ]);
    });

    it('should return empty array when all items are filtered', () => {
      const content = [null, undefined, { data: 'unknown', type: 'unknown' }];
      const result = convertSenseNovaMessage(content);
      expect(result).toEqual([]);
    });

    it('should handle empty array', () => {
      const result = convertSenseNovaMessage([]);
      expect(result).toEqual([]);
    });

    it('should handle base64 with different case (jpeg)', () => {
      const content = [
        {
          image_url: { url: 'data:image/JPEG;base64,ABC123' },
          type: 'image_url',
        },
      ];
      const result = convertSenseNovaMessage(content);
      // Should not convert because case doesn't match
      expect(result).toEqual([{ image_url: 'data:image/JPEG;base64,ABC123', type: 'image_url' }]);
    });
  });
});
