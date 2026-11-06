// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ai360ModelCard } from './index';
import { LobeAi360AI, params } from './index';

const createModel = (id: string, maxTokens: number, totalTokens: number): Ai360ModelCard => ({
  id,
  max_tokens: maxTokens,
  total_tokens: totalTokens,
});

const createModelsClient = (data: Ai360ModelCard[]) => ({
  models: { list: vi.fn().mockResolvedValue({ data }) },
});

describe('LobeAi360AI - custom features', () => {
  let instance: InstanceType<typeof LobeAi360AI>;

  beforeEach(() => {
    instance = new LobeAi360AI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('params.debug', () => {
    it('should disable debug mode by default', () => {
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug mode when DEBUG_AI360_CHAT_COMPLETION is set to 1', () => {
      process.env.DEBUG_AI360_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
    });

    it('should disable debug mode when DEBUG_AI360_CHAT_COMPLETION is not 1', () => {
      process.env.DEBUG_AI360_CHAT_COMPLETION = '0';
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
      delete process.env.DEBUG_AI360_CHAT_COMPLETION;
    });
  });

  describe('params.chatCompletion.handlePayload', () => {
    it('should add web_search tool when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeDefined();
      expect(result.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
      expect(result.tools?.find((tool: any) => tool.type === 'web_search')).toEqual({
        type: 'web_search',
        web_search: {
          search_mode: 'auto',
        },
      });
    });

    it('should not add web_search tool when enabledSearch is false', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: false,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeUndefined();
    });

    it('should not add web_search tool when enabledSearch is not present', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toBeUndefined();
    });

    it('should disable stream when tools are present', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: [{ type: 'function', function: { name: 'test' } }],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).toBe(false);
    });

    it('should disable stream when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).toBe(false);
    });

    it('should not set stream to false when no tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.stream).not.toBe(false);
    });

    it('should merge tools with web_search when enabledSearch is true', () => {
      const existingTool = { type: 'function', function: { name: 'existing_tool' } };
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [existingTool],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(2);
      expect(result.tools).toContainEqual(existingTool);
      expect(result.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should remove enabledSearch from payload', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.enabledSearch).toBeUndefined();
    });

    it('should preserve other payload properties', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 0.9,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.messages).toEqual(payload.messages);
      expect(result.model).toBe(payload.model);
      expect(result.temperature).toBe(payload.temperature);
      expect(result.max_tokens).toBe(payload.max_tokens);
      expect(result.top_p).toBe(payload.top_p);
    });

    it('should handle empty tools array when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(1);
      expect(result.tools?.[0].type).toBe('web_search');
    });

    it('should handle multiple existing tools when enabledSearch is true', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [
          { type: 'function', function: { name: 'tool1' } },
          { type: 'function', function: { name: 'tool2' } },
        ],
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);

      expect(result.tools).toHaveLength(3);
      expect(result.tools?.[0].function.name).toBe('tool1');
      expect(result.tools?.[1].function.name).toBe('tool2');
      expect(result.tools?.[2].type).toBe('web_search');
    });
  });

  describe('params.models', () => {
    it('should fetch and process models successfully', async () => {
      const mockClient = createModelsClient([
        createModel('360gpt-pro', 4096, 8192),
        createModel('360gpt2-o1', 8192, 16384),
      ]);

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(mockClient.models.list).toHaveBeenCalled();
    });

    it('should correctly map model properties', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('360gpt-pro');
      expect(model.contextWindowTokens).toBe(8192);
      expect(model.maxOutput).toBe(4096);
    });

    it('should detect 360gpt-pro as function call capable', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(true);
    });
    it('should handle case-insensitive reasoning keyword matching', async () => {
      const mockClient = createModelsClient([createModel('360GPT2-O1', 8192, 16384)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
    });

    it('should merge with LOBE_DEFAULT_MODEL_LIST for known models', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Known models from LOBE_DEFAULT_MODEL_LIST should have displayName and enabled flag
      expect(model.displayName).toBeDefined();
      expect(model.enabled).toBeDefined();
    });

    it('should handle models not in LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = createModelsClient([createModel('unknown-model', 2048, 4096)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('unknown-model');
      expect(model.displayName).toBeUndefined();
      expect(model.enabled).toBe(false);
    });

    it('should inherit abilities from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Check that abilities are inherited from known model
      expect(typeof model.functionCall).toBe('boolean');
      expect(typeof model.vision).toBe('boolean');
      expect(typeof model.reasoning).toBe('boolean');
    });
    it('should handle models with null max_tokens', async () => {
      const mockClient = createModelsClient([createModel('test-model', null as any, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.maxOutput).toBeUndefined();
    });

    it('should handle empty model list', async () => {
      const mockClient = createModelsClient([]);

      const models = await params.models!({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should handle model list with valid models only', async () => {
      const mockClient = createModelsClient([
        createModel('model1', 4096, 8192),
        createModel('model2', 2048, 4096),
      ]);

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models.every((m) => m !== null && m.id)).toBe(true);
    });

    it('should handle API errors gracefully', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockRejectedValue(new Error('API Error')),
        },
      };

      await expect(params.models!({ client: mockClient as any })).rejects.toThrow('API Error');
    });

    it('should set reasoning to false for non-reasoning models', async () => {
      const mockClient = createModelsClient([createModel('360gpt-base', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(false);
    });

    it('should set functionCall to false for non-360gpt-pro models without functionCall ability', async () => {
      const mockClient = createModelsClient([createModel('test-model', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.functionCall).toBe(false);
    });

    it('should set vision to false for models without vision ability', async () => {
      const mockClient = createModelsClient([createModel('test-model', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.vision).toBe(false);
    });

    it('should handle case-insensitive model ID matching with LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = createModelsClient([createModel('360GPT-PRO', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should match case-insensitively with LOBE_DEFAULT_MODEL_LIST
      expect(model.id).toBe('360GPT-PRO');
      expect(model.displayName).toBeDefined();
    });

    it('should handle models with all properties present', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('contextWindowTokens');
      expect(model).toHaveProperty('maxOutput');
      expect(model).toHaveProperty('functionCall');
      expect(model).toHaveProperty('vision');
      expect(model).toHaveProperty('reasoning');
      expect(model).toHaveProperty('enabled');
    });

    it('should detect all reasoning model variants correctly', async () => {
      const mockClient = createModelsClient([
        createModel('360gpt2-o1', 8192, 16384),
        createModel('360gpt2-o1-preview', 8192, 16384),
        createModel('360zhinao2-o1', 8192, 16384),
        createModel('360zhinao2-o1-mini', 8192, 16384),
      ]);

      const models = await params.models!({ client: mockClient as any });

      expect(models).toHaveLength(4);
      expect(models.every((m) => m.reasoning === true)).toBe(true);
    });

    it('should handle models with zero context window', async () => {
      const mockClient = createModelsClient([createModel('test-model', 0, 0)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.contextWindowTokens).toBe(0);
      expect(model.maxOutput).toBe(0);
    });
    it('should handle models with special characters in ID', async () => {
      const mockClient = createModelsClient([createModel('360gpt-pro-v2.0-beta', 4096, 8192)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.id).toBe('360gpt-pro-v2.0-beta');
    });
    it('should prioritize reasoning from keyword over knownModel', async () => {
      const mockClient = createModelsClient([createModel('360gpt2-o1-custom', 8192, 16384)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      // Should detect reasoning from keyword even if not in LOBE_DEFAULT_MODEL_LIST
      expect(model.reasoning).toBe(true);
    });

    it('should merge multiple capabilities correctly', async () => {
      const mockClient = createModelsClient([createModel('360gpt2-o1', 8192, 16384)]);

      const models = await params.models!({ client: mockClient as any });
      const model = models[0];

      expect(model.reasoning).toBe(true);
      expect(typeof model.functionCall).toBe('boolean');
      expect(typeof model.vision).toBe('boolean');
    });
  });

  describe('LobeAi360AI instance - integration tests', () => {
    it('should add web_search tool when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toBeDefined();
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should disable stream when tools are present', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: [{ type: 'function', function: { name: 'test' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).toBe(false);
    });

    it('should enable stream when no tools', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.stream).not.toBe(false);
    });

    it('should merge tools with web_search when enabledSearch is true', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        enabledSearch: true,
        tools: [{ type: 'function', function: { name: 'existing_tool' } }],
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.tools).toHaveLength(2);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'function')).toBe(true);
      expect(calledPayload.tools?.some((tool: any) => tool.type === 'web_search')).toBe(true);
    });

    it('should preserve temperature without normalization', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.7,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.temperature).toBe(0.7);
    });
    it('should preserve model name', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt2-o1',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('360gpt2-o1');
    });

    it('should handle combined parameters correctly', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        temperature: 0.8,
        top_p: 0.85,
        max_tokens: 2048,
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.model).toBe('360gpt-pro');
      expect(calledPayload.temperature).toBe(0.8);
      expect(calledPayload.top_p).toBe(0.85);
      expect(calledPayload.max_tokens).toBe(2048);
    });

    it('should not include undefined parameters in payload', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
      });

      const callArgs = vi.mocked(instance['client'].chat.completions.create).mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('temperature');
      expect(callArgs).not.toHaveProperty('top_p');
      expect(callArgs).not.toHaveProperty('max_tokens');
    });
  });

  describe('exports', () => {
    it('should export LobeAi360AI class', () => {
      expect(LobeAi360AI).toBeDefined();
      expect(typeof LobeAi360AI).toBe('function');
    });

    it('should export params with all required properties', () => {
      expect(params).toHaveProperty('provider');
      expect(params).toHaveProperty('baseURL');
      expect(params).toHaveProperty('chatCompletion');
      expect(params).toHaveProperty('debug');
      expect(params).toHaveProperty('models');
    });
  });

  describe('edge cases and comprehensive coverage', () => {
    it('should handle payload with undefined tools', () => {
      const payload = {
        messages: [{ content: 'Hello', role: 'user' }],
        model: '360gpt-pro',
        tools: undefined,
      } as any;

      const result = params.chatCompletion.handlePayload!(payload);
      expect(result.tools).toBeUndefined();
    });
    it('should handle empty messages array', async () => {
      await instance.chat({
        messages: [],
        model: '360gpt-pro',
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.messages).toEqual([]);
    });
  });
});
