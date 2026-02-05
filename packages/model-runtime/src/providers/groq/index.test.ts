// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { testProvider } from '../../providerTestUtils';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeGroq, params } from './index';

testProvider({
  provider: 'groq',
  defaultBaseURL: 'https://api.groq.com/openai/v1',
  chatModel: 'mistralai/mistral-7b-instruct:free',
  Runtime: LobeGroq,
  chatDebugEnv: 'DEBUG_GROQ_CHAT_COMPLETION',
});

// Mock the console.error to avoid polluting test output
vi.spyOn(console, 'error').mockImplementation(() => {});

let instance: LobeOpenAICompatibleRuntime;

beforeEach(() => {
  instance = new LobeGroq({ apiKey: 'test' });

  // 使用 vi.spyOn 来模拟 chat.completions.create 方法
  vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
    new ReadableStream() as any,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LobeGroq - custom features', () => {
  describe('filterAdvancedFields', () => {
    const filterAdvancedFields = params.generateObject!.handleSchema!;

    it('should filter out maxItems from schema', () => {
      const schema = {
        items: { type: 'string' },
        maxItems: 5,
        type: 'array',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        items: { type: 'string' },
        type: 'array',
      });
      expect(result.maxItems).toBeUndefined();
    });

    it('should filter out minItems from schema', () => {
      const schema = {
        items: { type: 'string' },
        minItems: 2,
        type: 'array',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        items: { type: 'string' },
        type: 'array',
      });
      expect(result.minItems).toBeUndefined();
    });

    it('should filter out maxLength from schema', () => {
      const schema = {
        maxLength: 100,
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'string',
      });
      expect(result.maxLength).toBeUndefined();
    });

    it('should filter out minLength from schema', () => {
      const schema = {
        minLength: 5,
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'string',
      });
      expect(result.minLength).toBeUndefined();
    });

    it('should filter out pattern from schema', () => {
      const schema = {
        pattern: '^[a-z]+$',
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'string',
      });
      expect(result.pattern).toBeUndefined();
    });

    it('should filter out format from schema', () => {
      const schema = {
        format: 'email',
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'string',
      });
      expect(result.format).toBeUndefined();
    });

    it('should filter out uniqueItems from schema', () => {
      const schema = {
        items: { type: 'number' },
        type: 'array',
        uniqueItems: true,
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        items: { type: 'number' },
        type: 'array',
      });
      expect(result.uniqueItems).toBeUndefined();
    });

    it('should filter out maxProperties from schema', () => {
      const schema = {
        maxProperties: 10,
        type: 'object',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'object',
      });
      expect(result.maxProperties).toBeUndefined();
    });

    it('should filter out minProperties from schema', () => {
      const schema = {
        minProperties: 2,
        type: 'object',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'object',
      });
      expect(result.minProperties).toBeUndefined();
    });

    it('should filter out multipleOf from schema', () => {
      const schema = {
        multipleOf: 5,
        type: 'number',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'number',
      });
      expect(result.multipleOf).toBeUndefined();
    });

    it('should filter out maximum from schema', () => {
      const schema = {
        maximum: 100,
        type: 'number',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'number',
      });
      expect(result.maximum).toBeUndefined();
    });

    it('should filter out minimum from schema', () => {
      const schema = {
        minimum: 0,
        type: 'number',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'number',
      });
      expect(result.minimum).toBeUndefined();
    });

    it('should filter out exclusiveMaximum from schema', () => {
      const schema = {
        exclusiveMaximum: 100,
        type: 'number',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'number',
      });
      expect(result.exclusiveMaximum).toBeUndefined();
    });

    it('should filter out exclusiveMinimum from schema', () => {
      const schema = {
        exclusiveMinimum: 0,
        type: 'number',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'number',
      });
      expect(result.exclusiveMinimum).toBeUndefined();
    });

    it('should filter out multiple unsupported properties at once', () => {
      const schema = {
        format: 'email',
        maxLength: 100,
        minLength: 5,
        pattern: '^[a-z]+$',
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        type: 'string',
      });
      expect(result.maxLength).toBeUndefined();
      expect(result.minLength).toBeUndefined();
      expect(result.pattern).toBeUndefined();
      expect(result.format).toBeUndefined();
    });

    it('should preserve supported properties', () => {
      const schema = {
        description: 'A test field',
        enum: ['a', 'b', 'c'],
        maxLength: 10,
        type: 'string',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        description: 'A test field',
        enum: ['a', 'b', 'c'],
        type: 'string',
      });
    });

    it('should handle nested objects recursively', () => {
      const schema = {
        properties: {
          email: {
            format: 'email',
            maxLength: 100,
            type: 'string',
          },
          name: {
            minLength: 2,
            type: 'string',
          },
        },
        type: 'object',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        properties: {
          email: {
            type: 'string',
          },
          name: {
            type: 'string',
          },
        },
        type: 'object',
      });
    });

    it('should handle deeply nested objects', () => {
      const schema = {
        properties: {
          user: {
            properties: {
              address: {
                maxProperties: 5,
                properties: {
                  city: {
                    maxLength: 50,
                    type: 'string',
                  },
                  zip: {
                    pattern: '^\\d{5}$',
                    type: 'string',
                  },
                },
                type: 'object',
              },
              name: {
                minLength: 1,
                type: 'string',
              },
            },
            type: 'object',
          },
        },
        type: 'object',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        properties: {
          user: {
            properties: {
              address: {
                properties: {
                  city: {
                    type: 'string',
                  },
                  zip: {
                    type: 'string',
                  },
                },
                type: 'object',
              },
              name: {
                type: 'string',
              },
            },
            type: 'object',
          },
        },
        type: 'object',
      });
    });

    it('should handle arrays in schema', () => {
      const schema = {
        items: {
          maxLength: 50,
          type: 'string',
        },
        maxItems: 10,
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        items: {
          type: 'string',
        },
        type: 'array',
      });
    });

    it('should handle arrays of objects', () => {
      const schema = {
        items: {
          properties: {
            age: {
              maximum: 120,
              minimum: 0,
              type: 'number',
            },
            name: {
              maxLength: 100,
              type: 'string',
            },
          },
          type: 'object',
        },
        type: 'array',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        items: {
          properties: {
            age: {
              type: 'number',
            },
            name: {
              type: 'string',
            },
          },
          type: 'object',
        },
        type: 'array',
      });
    });

    it('should handle null values', () => {
      const result = filterAdvancedFields(null);
      expect(result).toBeNull();
    });

    it('should handle primitive values', () => {
      expect(filterAdvancedFields('string')).toBe('string');
      expect(filterAdvancedFields(123)).toBe(123);
      expect(filterAdvancedFields(true)).toBe(true);
    });

    it('should handle empty objects', () => {
      const schema = {};
      const result = filterAdvancedFields(schema);
      expect(result).toEqual({});
    });

    it('should preserve required and other common fields', () => {
      const schema = {
        additionalProperties: false,
        description: 'A person object',
        maxProperties: 10,
        properties: {
          age: {
            description: 'Person age',
            maximum: 150,
            type: 'number',
          },
          name: {
            description: 'Person name',
            maxLength: 100,
            type: 'string',
          },
        },
        required: ['name', 'age'],
        type: 'object',
      };

      const result = filterAdvancedFields(schema);

      expect(result).toEqual({
        additionalProperties: false,
        description: 'A person object',
        properties: {
          age: {
            description: 'Person age',
            type: 'number',
          },
          name: {
            description: 'Person name',
            type: 'string',
          },
        },
        required: ['name', 'age'],
        type: 'object',
      });
    });
  });

  describe('Debug Configuration', () => {
    it('should disable debug by default', () => {
      delete process.env.DEBUG_GROQ_CHAT_COMPLETION;
      const result = params.debug.chatCompletion();
      expect(result).toBe(false);
    });

    it('should enable debug when env is set', () => {
      process.env.DEBUG_GROQ_CHAT_COMPLETION = '1';
      const result = params.debug.chatCompletion();
      expect(result).toBe(true);
      delete process.env.DEBUG_GROQ_CHAT_COMPLETION;
    });
  });

  describe('handlePayload', () => {
    it('should not set stream to false when payload contains tools', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0,
        tools: [
          {
            type: 'function',
            function: { name: 'tool1', description: '', parameters: {} },
          },
        ],
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
        expect.anything(),
      );
    });

    it('should set temperature to 0.7', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0.7,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 }),
        expect.anything(),
      );
    });

    it('should set temperature to undefined when temperature is 0', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: undefined }),
        expect.anything(),
      );
    });

    it('should set temperature to undefined when temperature is negative', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: -1,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: undefined }),
        expect.anything(),
      );
    });

    it('should default stream to true when not specified', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: true }),
        expect.anything(),
      );
    });

    it('should preserve stream value when explicitly set to false', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        stream: false,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ stream: false }),
        expect.anything(),
      );
    });

    it('should preserve other payload properties', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'mistralai/mistral-7b-instruct:free',
        temperature: 0.5,
        max_tokens: 100,
        top_p: 0.9,
      });

      expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: 'Hello', role: 'user' }],
          model: 'mistralai/mistral-7b-instruct:free',
          temperature: 0.5,
          max_tokens: 100,
          top_p: 0.9,
        }),
        expect.anything(),
      );
    });
  });

  describe('handleError', () => {
    it('should handle 403 location not supported error', () => {
      const error = { status: 403, message: 'Location not supported' };
      const result = params.chatCompletion.handleError?.(error as any);

      expect(result).toEqual({
        error,
        errorType: AgentRuntimeErrorType.LocationNotSupportError,
      });
    });

    it('should not handle other error statuses', () => {
      const error = { status: 401, message: 'Unauthorized' };
      const result = params.chatCompletion.handleError?.(error as any);

      expect(result).toBeUndefined();
    });

    it('should not handle 404 errors', () => {
      const error = { status: 404, message: 'Not found' };
      const result = params.chatCompletion.handleError?.(error as any);

      expect(result).toBeUndefined();
    });

    it('should not handle 500 errors', () => {
      const error = { status: 500, message: 'Internal server error' };
      const result = params.chatCompletion.handleError?.(error as any);

      expect(result).toBeUndefined();
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

    it('should fetch and process models with function call detection', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'llama-3.1-70b-versatile', context_window: 8192 },
          { id: 'mixtral-8x7b-32768', context_window: 32768 },
          { id: 'gemma2-9b-it', context_window: 8192 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({
        id: 'llama-3.1-70b-versatile',
        contextWindowTokens: 8192,
        functionCall: true, // Should detect function call from llama-3.1
      });
      expect(models[1]).toMatchObject({
        id: 'mixtral-8x7b-32768',
        contextWindowTokens: 32768,
        functionCall: true, // Should detect function call from mixtral-8x7b-32768
      });
      expect(models[2]).toMatchObject({
        id: 'gemma2-9b-it',
        contextWindowTokens: 8192,
        functionCall: true, // Should detect function call from gemma2-9b-it
      });
    });

    it('should detect vision capability from model id', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'llama-3.2-11b-vision-preview', context_window: 8192 },
          { id: 'llama-3.2-90b-vision-preview', context_window: 8192 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'llama-3.2-11b-vision-preview',
        vision: true,
      });
      expect(models[1]).toMatchObject({
        id: 'llama-3.2-90b-vision-preview',
        vision: true,
      });
    });

    it('should detect reasoning capability from model id', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'deepseek-r1-distill-llama-70b', context_window: 8192 },
          { id: 'deepseek-r1-distill-qwen-32b', context_window: 32768 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(2);
      expect(models[0]).toMatchObject({
        id: 'deepseek-r1-distill-llama-70b',
        reasoning: true,
      });
      expect(models[1]).toMatchObject({
        id: 'deepseek-r1-distill-qwen-32b',
        reasoning: true,
      });
    });

    it('should detect llama-3.3 function call capability', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'llama-3.3-70b-versatile', context_window: 8192 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'llama-3.3-70b-versatile',
        functionCall: true,
      });
    });

    it('should detect llama3- prefix function call capability', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'llama3-70b-8192', context_window: 8192 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'llama3-70b-8192',
        functionCall: true,
      });
    });

    it('should detect tool keyword function call capability', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'llama3-groq-70b-8192-tool-use-preview', context_window: 8192 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'llama3-groq-70b-8192-tool-use-preview',
        functionCall: true,
      });
    });

    it('should merge with known model list for display name and enabled status', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'llama-3.1-70b-versatile', context_window: 8192 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      // Should have displayName and enabled from LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
    });

    it('should handle models not in known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'unknown-model-id', context_window: 4096 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'unknown-model-id',
        contextWindowTokens: 4096,
        displayName: undefined,
        enabled: false,
        functionCall: false,
        vision: false,
        reasoning: false,
      });
    });

    it('should handle case-insensitive model matching', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [{ id: 'LLAMA-3.1-70B-VERSATILE', context_window: 8192 }],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('LLAMA-3.1-70B-VERSATILE');
      // Should match with lowercase in LOBE_DEFAULT_MODEL_LIST
      expect(models[0].displayName).toBeDefined();
    });

    it('should combine multiple capabilities', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          {
            id: 'llama-3.2-11b-vision-preview',
            context_window: 8192,
          },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: 'llama-3.2-11b-vision-preview',
        vision: true,
        // Vision models may not have function call by default
      });
    });

    it('should handle empty model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models).toEqual([]);
    });

    it('should preserve abilities from known model list', async () => {
      mockClient.models.list.mockResolvedValue({
        data: [
          { id: 'llama-3.2-11b-vision-preview', context_window: 8192 },
          { id: 'llama-3.1-70b-versatile', context_window: 131072 },
        ],
      });

      const models = await params.models({ client: mockClient as any });

      expect(models.length).toBeGreaterThan(0);
      // Models should inherit abilities from LOBE_DEFAULT_MODEL_LIST when available
      models.forEach((model) => {
        expect(model).toHaveProperty('functionCall');
        expect(model).toHaveProperty('vision');
        expect(model).toHaveProperty('reasoning');
      });
    });
  });
});
