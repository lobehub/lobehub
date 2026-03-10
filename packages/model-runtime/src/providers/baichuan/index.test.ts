// @vitest-environment node
import { ModelProvider } from 'model-bank';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { LobeBaichuanAI, params } from './index';

testProvider({
  Runtime: LobeBaichuanAI,
  provider: ModelProvider.Baichuan,
  defaultBaseURL: 'https://api.baichuan-ai.com/v1',
  chatDebugEnv: 'DEBUG_BAICHUAN_CHAT_COMPLETION',
  chatModel: 'hunyuan-lite',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeBaichuanAI({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeBaichuanAI - custom features', () => {
  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_BAICHUAN_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_BAICHUAN_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_BAICHUAN_CHAT_COMPLETION;
    });
  });

  describe('handlePayload - custom features', () => {
    it('should call API with corresponding options', async () => {
      // Arrange
      const mockStream = new ReadableStream();
      const mockResponse = Promise.resolve(mockStream);

      (instance['client'].chat.completions.create as Mock).mockResolvedValue(mockResponse);

      // Act
      const result = await instance.chat({
        max_tokens: 1024,
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'open-mistral-7b',
        temperature: 0.7,
        stream: true,
        top_p: 1,
      });

      // Assert
      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        {
          max_tokens: 1024,
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'open-mistral-7b',
          stream: true,
          stream_options: {
            include_usage: true,
          },
          temperature: 0.35,
          top_p: 1,
        },
        { headers: { Accept: '*/*' } },
      );
      expect(result).toBeInstanceOf(Response);
    });

    it('should add web_search tool when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeDefined();
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
      expect(
        calledPayload.tools?.find((tool: any) => tool.type === 'web_search')?.web_search?.enable,
      ).toBe(true);
    });

    it('should use default search_mode performance_first', async () => {
      delete process.env.BAICHUAN_SEARCH_MODE;

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const webSearchTool = calledPayload.tools?.find((tool: any) => tool.type === 'web_search');
      expect(webSearchTool?.web_search?.search_mode).toBe('performance_first');
    });

    it('should use custom search_mode from env', async () => {
      process.env.BAICHUAN_SEARCH_MODE = 'quality_first';

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      const webSearchTool = calledPayload.tools?.find((tool: any) => tool.type === 'web_search');
      expect(webSearchTool?.web_search?.search_mode).toBe('quality_first');

      delete process.env.BAICHUAN_SEARCH_MODE;
    });

    it('should not add web_search tool when enabledSearch is false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: false,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeUndefined();
    });

    it('should not add web_search tool when enabledSearch is undefined', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeUndefined();
    });

    it('should normalize temperature - 0 stays 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        temperature: 0,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0);
    });

    it('should normalize temperature by halving it', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        temperature: 0.5,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.25);
    });

    it('should normalize temperature to 1 when it is 2', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        temperature: 2,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(1);
    });

    it('should normalize temperature with undefined value', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        temperature: undefined,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBeUndefined();
    });

    it('should merge tools with web_search when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: true,
        tools: [{ type: 'function', function: { name: 'existing_tool' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(2);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'function')).toBe(true);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should preserve existing tools when enabledSearch is false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        enabledSearch: false,
        tools: [
          { type: 'function', function: { name: 'tool1' } },
          { type: 'function', function: { name: 'tool2' } },
        ],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(2);
      expect(calledPayload.tools?.every((tool: any) => tool.type === 'function')).toBe(true);
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'Baichuan3-Turbo',
        temperature: 0.8,
        max_tokens: 500,
        top_p: 0.95,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.messages).toEqual([{ content: 'Hello', role: 'user' }]);
      expect(calledPayload.model).toBe('Baichuan3-Turbo');
      expect(calledPayload.temperature).toBe(0.4);
      expect(calledPayload.max_tokens).toBe(500);
      expect(calledPayload.top_p).toBe(0.95);
    });
  });

  describe('models', () => {
    const mockClient = {
      models: {
        list: vi.fn(),
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should fetch and process models correctly', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 32768,
            max_tokens: 4096,
            model: 'Baichuan3-Turbo',
            model_show_name: 'Baichuan3-Turbo',
          },
          {
            function_call: false,
            max_input_length: 4096,
            max_tokens: 2048,
            model: 'Baichuan2-Turbo',
            model_show_name: 'Baichuan2-Turbo',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'Baichuan3-Turbo',
        displayName: 'Baichuan3-Turbo',
        contextWindowTokens: 32768,
        maxOutput: 4096,
        functionCall: true,
        enabled: false,
        reasoning: false,
        vision: false,
      });
      expect(models[1]).toMatchObject({
        id: 'Baichuan2-Turbo',
        displayName: 'Baichuan2-Turbo',
        contextWindowTokens: 4096,
        maxOutput: 2048,
        functionCall: false,
        enabled: false,
        reasoning: false,
        vision: false,
      });
    });

    it('should merge with known model list for enabled status and abilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 32768,
            max_tokens: 4096,
            model: 'Baichuan3-Turbo',
            model_show_name: 'Baichuan3 Turbo',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should have properties from API
      expect(models[0].id).toBe('Baichuan3-Turbo');
      expect(models[0].displayName).toBe('Baichuan3 Turbo');
      expect(models[0].contextWindowTokens).toBe(32768);
      expect(models[0].maxOutput).toBe(4096);
      expect(models[0].functionCall).toBe(true);
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 32768,
            max_tokens: 4096,
            model: 'BAICHUAN3-TURBO',
            model_show_name: 'Baichuan3 Turbo Upper',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('BAICHUAN3-TURBO');
      // Should match with lowercase comparison
      expect(models[0].displayName).toBe('Baichuan3 Turbo Upper');
    });

    it('should preserve abilities from known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 32768,
            max_tokens: 4096,
            model: 'Baichuan3-Turbo',
            model_show_name: 'Baichuan3-Turbo',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Models should have ability properties
      expect(models[0]).toHaveProperty('functionCall');
      expect(models[0]).toHaveProperty('vision');
      expect(models[0]).toHaveProperty('reasoning');
      expect(models[0]).toHaveProperty('enabled');
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle models not in known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: false,
            max_input_length: 8192,
            max_tokens: 2048,
            model: 'unknown-model-id',
            model_show_name: 'Unknown Model',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'unknown-model-id',
        displayName: 'Unknown Model',
        contextWindowTokens: 8192,
        maxOutput: 2048,
        functionCall: false,
        enabled: false,
        reasoning: false,
        vision: false,
      });
    });

    it('should handle model with all capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 128000,
            max_tokens: 8192,
            model: 'Baichuan4-Pro',
            model_show_name: 'Baichuan4 Pro',
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'Baichuan4-Pro',
        displayName: 'Baichuan4 Pro',
        contextWindowTokens: 128000,
        maxOutput: 8192,
        functionCall: true,
      });
    });

    it('should filter out null or undefined models', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            function_call: true,
            max_input_length: 32768,
            max_tokens: 4096,
            model: 'Baichuan3-Turbo',
            model_show_name: 'Baichuan3-Turbo',
          },
          null,
          undefined,
        ],
      });

      const models = await params.models({ client: mockClient as any });

      // Should only have the valid model
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('Baichuan3-Turbo');
    });
  });
});
